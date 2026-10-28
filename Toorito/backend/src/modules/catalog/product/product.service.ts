import { flashState } from "@modules/inventory/inventory.util";
import {
    normalizeSearch,
    num,
    pageParams,
    randomToken,
    toUrlSlug,
} from "@common/utils/helpers.util";
import { CurrencyService } from "@core/currency/currency.service";
import { PrismaService } from "@core/database/prisma.service";
import { LocaleService } from "@core/locale/locale.service";
import { BrandService } from "../brand/brand.service";
import { CategoryService } from "../category/category.service";
import { OptionService } from "../option/option.service";
import {
    BarcodeInput,
    BulkAssignProductsInput,
    BulkProductIdsInput,
    BulkProductStatusInput,
    CheckProductSlugInput,
    CheckSkuInput,
    CreateProductInput,
    GenerateSkusInput,
    ListProductsInput,
    ManufacturerSuggestionInput,
    MAX_GALLERY_ITEMS,
    MAX_VARIANT_MEDIA,
    MAX_VARIANTS,
    QuickEditProductInput,
    TranslationInput,
    UpdateProductInput,
    UpdateProductOptionsInput,
    UpdateProductStatusInput,
    UpdateVariantInput,
    VariantInput,
} from "./product.types";
import { CatalogCacheService } from "../shared/catalog-cache.service";
import { throwUniqueConflict } from "../shared/catalog.util";
import { MediaService } from "@modules/media/media.service";
import {
    BadRequestException,
    ConflictException,
    ForbiddenException,
    HttpException,
    Injectable,
    NotFoundException,
} from "@nestjs/common";
import {
    BarcodeType,
    Prisma,
    ProductStatus,
    ProductVariant,
} from "@prisma-client/client";
import { I18nService } from "nestjs-i18n";
import { StockService } from "@modules/inventory/stock.service";

/** Transaction options for writes that touch many rows (product + variants). */
const LONG_TRANSACTION = { timeout: 30_000, maxWait: 10_000 } as const;

/** Product slug column limit (120) minus room for a "-N" suffix. */
const SLUG_BASE_MAX_LENGTH = 110;

/** SKU column limit (64) minus room for a "-N" suffix. */
const SKU_CANDIDATE_MAX_LENGTH = 54;

/** Digit count of GTIN barcode types; other types are not format-checked. */
const GTIN_LENGTH: Record<string, number> = {
    EAN13: 13,
    EAN8: 8,
    UPCA: 12,
    UPC_A: 12,
    UPC: 12,
    GTIN14: 14,
    ITF14: 14,
};

/**
 * Sorts the admin list resolves in SQL, because Prisma cannot order by a
 * translated title or by an aggregate (cheapest variant) of a to-many relation.
 */
type SqlSort = "name_asc" | "name_desc" | "price_asc" | "price_desc";
const SQL_SORTS: readonly string[] = [
    "name_asc",
    "name_desc",
    "price_asc",
    "price_desc",
];

type Db = Prisma.TransactionClient;
type MediaKind = "image" | "video" | "audio" | "other";

/** Shapes of the stored nutrition table JSON (see `NutritionTableDto`). */
type NutritionColumn = { label?: string; children?: NutritionColumn[] };
type NutritionRow = {
    label?: string;
    values?: string[];
    children?: NutritionRow[];
};
type NutritionTable = { columns?: NutritionColumn[]; rows?: NutritionRow[] };

/**
 * Relations loaded for the full product detail view. Shared by the admin
 * view (`adminGet`) and the store view (`storeGet`) so both stay identical.
 */
const PRODUCT_DETAIL_INCLUDE = {
    translations: true,
    options: {
        include: { optionGroup: true },
        orderBy: { position: "asc" },
    },
    variants: {
        where: { deletedAt: null },
        include: {
            barcodes: true,
            optionValues: { include: { optionValue: true } },
            media: { include: { media: true } },
        },
        orderBy: { position: "asc" },
    },
    media: {
        where: { variantId: null },
        include: { media: true },
        orderBy: { position: "asc" },
    },
    brand: true,
    category: true,
} satisfies Prisma.ProductInclude;

/** A validated variant ready to be persisted (see `buildVariantRows`). */
interface VariantRow {
    /** The variant payload as supplied by the admin (SKU filled in when auto-generated). */
    variantInput: VariantInput;
    /** Option hash, e.g. "12-45", or "default" for a simple product. */
    optionHash: string;
    /** One (option group, option value, optional image override) per product option. */
    optionLinks: {
        optionGroupId: bigint;
        optionValueId: bigint;
        imageId: bigint | null;
    }[];
    /** Option value codes in option order, used to auto-generate a SKU. */
    optionCodes: string[];
}

/** A validated variant of a product update: `id` set = edit, unset = add. */
interface VariantSyncRow extends VariantRow {
    id?: bigint;
}

/**
 * Everything `updateProduct` needs to turn the product's current variants
 * into the requested ones (add / edit / delete) in one transaction.
 */
interface VariantSyncPlan {
    /** `true` when the product ends up with option types (variable product). */
    isVariable: boolean;
    optionGroupIds: bigint[];
    optionsChanged: boolean;
    rows: VariantSyncRow[];
    /** Existing variants that are not part of the request -> soft-deleted. */
    removeIds: bigint[];
}

type ProductWithStructure = Prisma.ProductGetPayload<{
    include: { options: true; variants: true };
}>;

type VariantScalars = Pick<
    ProductVariant,
    | "sku"
    | "mrp"
    | "unit"
    | "unitValue"
    | "weightGrams"
    | "position"
    | "isActive"
    | "audioMediaId"
>;

/** Result of a bulk action: which ids worked and why the others failed. */
export interface BulkResult {
    succeeded: string[];
    failed: { id: string; message: string }[];
}

/**
 * Product domain service: admin CRUD (create, read, update, soft delete,
 * restore, permanent delete), variant management, listing tools (bulk,
 * quick edit, counts) and storefront reads.
 *
 * Draft vs publish
 *  - A DRAFT may be saved half-filled: one of title / category / variant is enough.
 *  - A PUBLISHED product must ALWAYS satisfy {@link publishProblems}. Every
 *    write that touches a published product re-checks it inside its
 *    transaction, so an invalid edit is rolled back.
 *
 * Collaborators:
 *  - `CategoryService` -> category must exist and be ACTIVE, category tree for filters.
 *  - `BrandService`    -> brand must exist and be ACTIVE, brand names for search text.
 *  - `OptionService`   -> option group / option value validation for variants.
 */
@Injectable()
export class ProductService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly cache: CatalogCacheService,
        private readonly media: MediaService,
        private readonly locale: LocaleService,
        private readonly i18n: I18nService,
        private readonly currency: CurrencyService,
        private readonly categories: CategoryService,
        private readonly brands: BrandService,
        private readonly options: OptionService,
        private readonly stock: StockService,
    ) {}

    // ============ small helpers ============

    private t(key: string, args?: Record<string, unknown>): string {
        return this.i18n.translate(key, args ? { args } : {}) as string;
    }

    /** Maps a Prisma unique violation to a 409 (see `throwUniqueConflict`). */
    private mapUnique(error: unknown, fallbackKey?: string): never {
        return throwUniqueConflict(this.i18n, error, fallbackKey);
    }

    /** Lets HTTP errors thrown inside a transaction through untouched. */
    private rethrow(error: unknown, fallbackKey?: string): never {
        if (error instanceof HttpException) throw error;
        return this.mapUnique(error, fallbackKey);
    }

    /** Human-readable message of any error (used by bulk results). */
    private errorMessage(error: unknown): string {
        if (error instanceof HttpException) {
            const response = error.getResponse();
            if (typeof response === "string") return response;
            const message = (response as { message?: unknown }).message;
            if (Array.isArray(message)) return message.join("; ");
            return String(message ?? error.message);
        }
        return this.t("catalog.common.unexpected");
    }

    /** Converts a DTO value into a Prisma JSON input (`null` clears the column). */
    private json(value: unknown) {
        if (value === undefined) return undefined;
        if (value === null) return Prisma.DbNull;
        return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
    }

    private notFound(): never {
        throw new NotFoundException(this.t("catalog.product.notFound"));
    }

    /**
     * Locks the live product row for the rest of the transaction
     * (`SELECT ... FOR UPDATE`), so concurrent writes to the same product
     * (two admins, a double click, a bulk action) run one after another
     * instead of interleaving.
     *
     * @param expectedUpdatedAt - When set, the write is rejected with 409 if
     *   the product changed since the caller read it (optimistic lock).
     * @throws NotFoundException if the product is missing or in the trash.
     * @throws ConflictException if the product changed meanwhile.
     */
    private async lockProductTx(tx: Db, id: bigint, expectedUpdatedAt?: Date) {
        const [row] = await tx.$queryRaw<
            {
                status: ProductStatus;
                publishedAt: Date | null;
                updatedAt: Date;
            }[]
        >(Prisma.sql`
            SELECT "status", "publishedAt", "updatedAt"
            FROM "Product"
            WHERE id = ${id} AND "deletedAt" IS NULL
            FOR UPDATE
        `);
        if (!row) this.notFound();
        if (
            expectedUpdatedAt &&
            row.updatedAt.getTime() !== new Date(expectedUpdatedAt).getTime()
        ) {
            throw new ConflictException(this.t("catalog.product.staleUpdate"));
        }
        return row;
    }

    /** Bumps `Product.updatedAt` after a write that only touched child rows (variants). */
    private async touchProductTx(tx: Db, id: bigint) {
        await tx.product.update({
            where: { id },
            data: { updatedAt: new Date() },
        });
    }

    // ============ validation helpers ============

    /**
     * Validates a product's translation list: every language supported, no
     * language twice. The default language is only required to publish.
     */
    private assertTranslationsValid(translations: TranslationInput[]) {
        const seenLanguages = new Set<string>();
        for (const translation of translations) {
            if (!this.locale.isSupported(translation.lang)) {
                throw new BadRequestException(
                    this.t("catalog.translation.unsupportedLanguage", {
                        language: translation.lang,
                    }),
                );
            }
            if (seenLanguages.has(translation.lang)) {
                throw new BadRequestException(
                    this.t("catalog.translation.duplicate", {
                        language: translation.lang,
                    }),
                );
            }
            seenLanguages.add(translation.lang);
        }
    }

    /** A draft needs at least one required field: a title, a category or a variant. */
    private assertHasDraftContent(dto: CreateProductInput) {
        const hasTitle = dto.translations?.some((item) => item.title?.trim());
        if (!hasTitle && !dto.categoryId && !dto.variants?.length) {
            throw new BadRequestException(this.t("catalog.product.draftEmpty"));
        }
    }

    /**
     * Validates the category and brand a product points at.
     *
     * @param categoryId - Category that must exist and be ACTIVE (skipped when omitted).
     * @param brandId - Brand that must exist and be ACTIVE (skipped when omitted).
     */
    private async assertCategoryAndBrand(
        categoryId?: bigint | null,
        brandId?: bigint | null,
    ) {
        if (categoryId) await this.categories.assertActive(categoryId);
        if (brandId) await this.brands.assertActive(brandId);
    }

    /** Ensures a product slug is not used by another product. */
    private async assertSlugFree(slug: string, currentProductId?: bigint) {
        const owner = await this.prisma.product.findUnique({
            where: { slug },
            select: { id: true },
        });
        if (owner && owner.id !== currentProductId) {
            throw new ConflictException(this.t("catalog.product.slugTaken"));
        }
    }

    private slugBase(source: string) {
        return toUrlSlug(source)
            .slice(0, SLUG_BASE_MAX_LENGTH)
            .replace(/-+$/, "");
    }

    /** Produces a product slug that is not yet in use (for auto-generated slugs). */
    private async uniqueSlug(baseSlug: string) {
        let candidate = baseSlug || `p-${randomToken(4)}`;
        while (
            await this.prisma.product.findUnique({
                where: { slug: candidate },
                select: { id: true },
            })
        ) {
            candidate = `${baseSlug || "p"}-${randomToken(2)}`;
        }
        return candidate;
    }

    /** Default-language title, else the first non-empty title. */
    private pickTitle(translations: TranslationInput[]) {
        const defaultTitle = translations
            .find((item) => item.lang === this.locale.defaultLanguage)
            ?.title?.trim();
        return (
            defaultTitle ||
            translations.find((item) => item.title?.trim())?.title?.trim() ||
            ""
        );
    }

    /**
     * Checks whether a product slug is available (queries the DB directly, no
     * cache). When taken, suggests the next free `slug-N` (not reserved).
     */
    async checkSlug(query: CheckProductSlugInput) {
        const slugInput = query.slug?.trim();
        const titleInput = query.title?.trim();
        if (!slugInput && !titleInput) {
            throw new BadRequestException(
                this.t("catalog.product.slugInputRequired"),
            );
        }

        const baseSlug = this.slugBase(slugInput || titleInput || "");
        if (!baseSlug) {
            throw new BadRequestException(
                this.t("catalog.product.slugInvalid"),
            );
        }

        const rows = await this.prisma.product.findMany({
            where: {
                ...(query.excludeId ? { id: { not: query.excludeId } } : {}),
                slug: { startsWith: baseSlug },
            },
            select: { slug: true },
        });

        const existingSlugs = new Set(rows.map((row) => row.slug));
        if (!existingSlugs.has(baseSlug)) {
            return { exists: false, slug: baseSlug, suggestion: null };
        }

        let counter = 2;
        let suggestion = `${baseSlug}-${counter}`;
        while (existingSlugs.has(suggestion)) {
            suggestion = `${baseSlug}-${++counter}`;
        }
        return { exists: true, slug: baseSlug, suggestion };
    }

    // ============ media ============

    private mediaKind(mimeType: string | null | undefined): MediaKind {
        if (!mimeType) return "other";
        if (mimeType.startsWith("image/")) return "image";
        if (mimeType.startsWith("video/")) return "video";
        if (mimeType.startsWith("audio/")) return "audio";
        return "other";
    }

    /**
     * Validates every media reference of a product write in one query:
     *  - gallery: max 15, unique, images / videos, first one is an image (thumbnail).
     *  - variant galleries: max 10 each, unique, images / videos.
     *  - option image overrides: images.
     *  - audio (product and per variant): an audio file.
     */
    private async assertMedia(input: {
        gallery?: bigint[] | null;
        audioId?: bigint | null;
        variantMedia?: (bigint[] | undefined)[];
        variantAudio?: (bigint | null | undefined)[];
        optionImages?: bigint[];
    }) {
        const gallery = (input.gallery ?? []).map(BigInt);
        const variantLists = (input.variantMedia ?? [])
            .filter((list): list is bigint[] => Array.isArray(list))
            .map((list) => list.map(BigInt));
        const optionImages = (input.optionImages ?? []).map(BigInt);
        const audioIds = [input.audioId, ...(input.variantAudio ?? [])]
            .filter((id): id is bigint => id != null)
            .map(BigInt);

        const allIds = [
            ...gallery,
            ...variantLists.flat(),
            ...optionImages,
            ...audioIds,
        ];
        if (!allIds.length) return;

        const uniqueIds = [...new Set(allIds.map(String))].map(BigInt);
        // NOTE: assumes `MediaFile.mimeType`; rename if your column differs.
        const files = await this.prisma.mediaFile.findMany({
            where: { id: { in: uniqueIds } },
            select: { id: true, mimeType: true },
        });
        const kindById = new Map(
            files.map((file) => [
                file.id.toString(),
                this.mediaKind(file.mimeType),
            ]),
        );
        const fail = (key: string, args?: Record<string, unknown>): never => {
            throw new BadRequestException(this.t(key, args));
        };
        const kindOf = (id: bigint) => kindById.get(id.toString());
        const isVisual = (id: bigint) =>
            kindOf(id) === "image" || kindOf(id) === "video";
        const hasDuplicates = (ids: bigint[]) =>
            new Set(ids.map(String)).size !== ids.length;

        const missing = uniqueIds.find((id) => !kindById.has(id.toString()));
        if (missing !== undefined) {
            fail("catalog.media.notFound", { id: missing.toString() });
        }

        if (gallery.length > MAX_GALLERY_ITEMS) {
            fail("catalog.media.galleryLimit", { max: MAX_GALLERY_ITEMS });
        }
        if (hasDuplicates(gallery)) fail("catalog.media.duplicate");
        if (gallery.some((id) => !isVisual(id)))
            fail("catalog.media.galleryType");
        if (gallery.length && kindOf(gallery[0]) !== "image") {
            fail("catalog.media.thumbnailImage");
        }

        for (const list of variantLists) {
            if (list.length > MAX_VARIANT_MEDIA) {
                fail("catalog.media.variantLimit", { max: MAX_VARIANT_MEDIA });
            }
            if (hasDuplicates(list)) fail("catalog.media.duplicate");
            if (list.some((id) => !isVisual(id)))
                fail("catalog.media.galleryType");
        }

        if (optionImages.some((id) => kindOf(id) !== "image")) {
            fail("catalog.media.optionImageType");
        }
        if (audioIds.some((id) => kindOf(id) !== "audio")) {
            fail("catalog.media.audioType");
        }
    }

    // ============ nutrition ============

    /** Structure-only fingerprint of a table (labels / values ignored). */
    private nutritionShape(table: NutritionTable): string {
        const column = (item: NutritionColumn): string =>
            item.children?.length
                ? `[${item.children.map(column).join(",")}]`
                : "c";
        const row = (item: NutritionRow): string =>
            item.children?.length
                ? `r[${item.children.map(row).join(",")}]`
                : "r";
        return `${(table.columns ?? []).map(column).join(",")}|${(table.rows ?? []).map(row).join(",")}`;
    }

    private leafColumnCount(columns: NutritionColumn[] = []): number {
        return columns.reduce(
            (count, column) =>
                count +
                (column.children?.length
                    ? this.leafColumnCount(column.children)
                    : 1),
            0,
        );
    }

    private treeDepth<T extends { children?: T[] }>(items: T[] = []): number {
        return items.length
            ? 1 +
                  Math.max(
                      ...items.map((item) => this.treeDepth(item.children)),
                  )
            : 0;
    }

    /**
     * Validates the nutrition tables sent with a request: max 2 header levels
     * (columns + sub-columns), max 3 row levels, one value per leaf column,
     * and the same structure in every language.
     */
    private assertNutritionTables(translations: TranslationInput[]) {
        const shapes = new Set<string>();
        for (const translation of translations) {
            const table = translation.nutrition;
            if (!table) continue;

            if (
                this.treeDepth(table.columns) > 2 ||
                this.treeDepth(table.rows) > 3
            ) {
                throw new BadRequestException(
                    this.t("catalog.nutrition.tooDeep", {
                        language: translation.lang,
                    }),
                );
            }

            const leafCount = this.leafColumnCount(table.columns);
            const valuesFit = (rows: NutritionRow[] = []): boolean =>
                rows.every(
                    (row) =>
                        (!row.values?.length ||
                            row.values.length === leafCount) &&
                        valuesFit(row.children),
                );
            if (!valuesFit(table.rows)) {
                throw new BadRequestException(
                    this.t("catalog.nutrition.valueCount", {
                        language: translation.lang,
                        count: leafCount,
                    }),
                );
            }
            shapes.add(this.nutritionShape(table));
        }
        if (shapes.size > 1) {
            throw new BadRequestException(
                this.t("catalog.nutrition.shapeMismatch"),
            );
        }
    }

    // ============ publish rules ============

    /**
     * Every rule a PUBLISHED product must satisfy. Returns all problems at
     * once (empty = publishable) so the UI can show a complete checklist.
     *
     *  - Category set and ACTIVE; brand ACTIVE when set.
     *  - Default-language title.
     *  - At least one live variant, at least one active variant.
     *  - Simple product: exactly one live variant. Variable: every variant
     *    has one option value per option type.
     *  - Nutrition tables share one structure across languages.
     */
    private async publishProblems(db: Db, id: bigint): Promise<string[]> {
        const product = await db.product.findUniqueOrThrow({
            where: { id },
            select: {
                categoryId: true,
                brandId: true,
                _count: { select: { options: true } },
                translations: {
                    select: { lang: true, title: true, nutrition: true },
                },
                variants: {
                    where: { deletedAt: null },
                    select: {
                        sku: true,
                        isActive: true,
                        _count: { select: { optionValues: true } },
                    },
                },
            },
        });

        const problems: string[] = [];

        if (!product.categoryId) {
            problems.push(this.t("catalog.publish.categoryRequired"));
        } else {
            try {
                await this.categories.assertActive(product.categoryId);
            } catch (error) {
                problems.push(this.errorMessage(error));
            }
        }
        if (product.brandId && !(await this.brands.isActive(product.brandId))) {
            problems.push(this.t("catalog.brand.notFound"));
        }

        const defaultTranslation = product.translations.find(
            (item) => item.lang === this.locale.defaultLanguage,
        );
        if (!defaultTranslation?.title?.trim()) {
            problems.push(
                this.t("catalog.translation.defaultRequired", {
                    language: this.locale.defaultLanguage,
                }),
            );
        }

        const optionCount = product._count.options;
        const variants = product.variants;
        if (!variants.length) {
            problems.push(this.t("catalog.variant.minimumRequired"));
        } else if (!variants.some((variant) => variant.isActive)) {
            problems.push(this.t("catalog.variant.minimumActive"));
        }
        if (!optionCount && variants.length > 1) {
            problems.push(this.t("catalog.variant.generalSingle"));
        }

        const unmapped = variants
            .filter((variant) => variant._count.optionValues !== optionCount)
            .map((variant) => variant.sku);
        if (unmapped.length) {
            problems.push(
                this.t("catalog.publish.optionValuesRequired", {
                    skus: unmapped.join(", "),
                }),
            );
        }

        const shapes = new Set(
            product.translations
                .filter((item) => item.nutrition)
                .map((item) =>
                    this.nutritionShape(item.nutrition as NutritionTable),
                ),
        );
        if (shapes.size > 1) {
            problems.push(this.t("catalog.nutrition.shapeMismatch"));
        }

        return problems;
    }

    /** Throws a 400 listing every publishing problem. */
    private async assertPublishableTx(db: Db, id: bigint) {
        const problems = await this.publishProblems(db, id);
        if (problems.length) throw new BadRequestException(problems);
    }

    /** Re-checks the publish rules only when the product is PUBLISHED. */
    private async assertStillPublishableTx(tx: Db, productId: bigint) {
        const product = await tx.product.findUniqueOrThrow({
            where: { id: productId },
            select: { status: true },
        });
        if (product.status === ProductStatus.PUBLISHED) {
            await this.assertPublishableTx(tx, productId);
        }
    }

    // ============ search text ============

    /**
     * Rebuilds the denormalized `searchText` of every translation from stored
     * data: title + brand names (all languages) + keywords + live SKUs.
     * Called at the end of every write that can change any of those.
     */
    private async rebuildSearchTextTx(tx: Db, productId: bigint) {
        const product = await tx.product.findUniqueOrThrow({
            where: { id: productId },
            select: {
                brandId: true,
                translations: {
                    select: { lang: true, title: true, keywords: true },
                },
                variants: {
                    where: { deletedAt: null },
                    select: { sku: true },
                },
            },
        });
        const brandNames = await this.brands.names(product.brandId);
        const skus = product.variants.map((variant) => variant.sku);

        for (const translation of product.translations) {
            const keywords = Array.isArray(translation.keywords)
                ? translation.keywords.filter(
                      (keyword): keyword is string =>
                          typeof keyword === "string",
                  )
                : [];
            await tx.productTranslation.update({
                where: {
                    productId_lang: { productId, lang: translation.lang },
                },
                data: {
                    searchText: normalizeSearch(
                        [
                            translation.title,
                            ...brandNames,
                            ...keywords,
                            ...skus,
                        ].join(" "),
                    ),
                },
            });
        }
    }

    /**
     * Splits a search query into normalized tokens (max 6), with LIKE
     * wildcards neutralized.
     */
    private tokenize(query: string) {
        return normalizeSearch(query)
            .replace(/[%_\\]/g, " ")
            .split(" ")
            .filter(Boolean)
            .slice(0, 6);
    }

    /** Translation columns written from a DTO (undefined = keep). */
    private translationData(translation: TranslationInput) {
        return {
            title:
                translation.title == null
                    ? undefined
                    : translation.title.trim(),
            shortDescription: translation.shortDescription,
            description: translation.description,
            keyFeatures: this.json(translation.keyFeatures),
            ingredients: translation.ingredients,
            storageInstructions: translation.storageInstructions,
            manufacturerAddress: translation.manufacturerAddress,
            allergens: this.json(translation.allergens),
            attributes: this.json(translation.attributes),
            nutrition: this.json(translation.nutrition),
            keywords: this.json(translation.keywords),
            seoTitle: translation.seoTitle,
            seoDescription: translation.seoDescription,
        };
    }

    // ============ SKU ============

    private optionValueCode(value: { id: bigint }) {
        const code = (value as { code?: unknown }).code;
        return typeof code === "string" && code ? code : value.id.toString();
    }

    private skuBase(source: string) {
        return (
            toUrlSlug(source).toUpperCase().slice(0, 24).replace(/-+$/, "") ||
            "SKU"
        );
    }

    private skuCandidate(base: string, optionCodes: string[]) {
        const tokens = optionCodes.map((code) =>
            toUrlSlug(code).toUpperCase().replace(/-/g, "").slice(0, 12),
        );
        return [base, ...tokens]
            .filter(Boolean)
            .join("-")
            .slice(0, SKU_CANDIDATE_MAX_LENGTH)
            .replace(/-+$/, "");
    }

    /**
     * Turns SKU candidates into globally unique SKUs: a taken candidate gets
     * `-2`, `-3`, ... `reserved` SKUs (from the same form) count as taken.
     */
    private async allocateSkus(
        candidates: string[],
        reserved: Set<string>,
        excludeProductId?: bigint,
    ) {
        const taken = new Set(reserved);
        const bases = [...new Set(candidates)];
        if (bases.length) {
            const rows = await this.prisma.productVariant.findMany({
                where: {
                    OR: bases.map((base) => ({ sku: { startsWith: base } })),
                    ...(excludeProductId
                        ? { NOT: { productId: excludeProductId } }
                        : {}),
                },
                select: { sku: true },
            });
            for (const row of rows) taken.add(row.sku);
        }

        return candidates.map((candidate) => {
            let sku = candidate;
            let counter = 2;
            while (taken.has(sku)) sku = `${candidate}-${counter++}`;
            taken.add(sku);
            return sku;
        });
    }

    /** Fills `sku` on every row that has none, from `source` + option value codes. */
    private async assignMissingSkus(
        rows: VariantRow[],
        source: string,
        excludeProductId?: bigint,
    ) {
        const missing = rows.filter((row) => !row.variantInput.sku);
        if (!missing.length) return;

        const base = this.skuBase(source);
        const reserved = new Set(
            rows
                .map((row) => row.variantInput.sku)
                .filter((sku): sku is string => !!sku),
        );
        const skus = await this.allocateSkus(
            missing.map((row) => this.skuCandidate(base, row.optionCodes)),
            reserved,
            excludeProductId,
        );
        missing.forEach((row, index) => {
            row.variantInput.sku = skus[index];
        });
    }

    /** SKUs are globally unique (live and soft-deleted rows keep distinct values). */
    private async assertSkusFree(
        skus: string[],
        excludeVariantIds: bigint[] = [],
    ) {
        if (!skus.length) return;
        const clash = await this.prisma.productVariant.findFirst({
            where: {
                sku: { in: skus },
                ...(excludeVariantIds.length
                    ? { id: { notIn: excludeVariantIds } }
                    : {}),
            },
            select: { sku: true },
        });
        if (clash) {
            throw new ConflictException(
                this.t("catalog.variant.skuExists", { sku: clash.sku }),
            );
        }
    }

    /** GET admin/products/check-sku */
    async checkSku(query: CheckSkuInput) {
        const owner = await this.prisma.productVariant.findUnique({
            where: { sku: query.sku },
            select: { id: true },
        });
        const exists = !!owner && owner.id !== query.excludeVariantId;
        const suggestion = exists
            ? (
                  await this.allocateSkus(
                      [query.sku.slice(0, SKU_CANDIDATE_MAX_LENGTH)],
                      new Set(),
                  )
              )[0]
            : null;
        return { exists, sku: query.sku, suggestion };
    }

    /**
     * POST admin/products/generate-skus: one unique SKU per variant row,
     * built from the slug / title and the option value codes
     * (e.g. ORGANIC-BASMATI-RICE-1KG). Nothing is reserved.
     */
    async generateSkus(dto: GenerateSkusInput) {
        const valueIds = dto.variants
            .flatMap((variant) => variant.optionValueIds ?? [])
            .map(BigInt);
        const values = valueIds.length
            ? await this.options.findValuesByIds(valueIds)
            : [];
        const codeById = new Map(
            values.map((value) => [
                value.id.toString(),
                this.optionValueCode(value),
            ]),
        );
        const base = this.skuBase(dto.slug || dto.title || "");
        const candidates = dto.variants.map((variant) =>
            this.skuCandidate(
                base,
                (variant.optionValueIds ?? []).map(
                    (id) => codeById.get(String(id)) ?? String(id),
                ),
            ),
        );
        const skus = await this.allocateSkus(
            candidates,
            new Set(dto.reserved ?? []),
            dto.excludeProductId,
        );
        return { skus };
    }

    // ============ barcodes ============

    /** GTIN mod-10 check digit (EAN-8 / EAN-13 / UPC-A / GTIN-14). */
    private gtinChecksumValid(code: string) {
        const digits = code.split("").map(Number);
        const checkDigit = digits.pop()!;
        const sum = digits
            .reverse()
            .reduce(
                (total, digit, index) =>
                    total + digit * (index % 2 === 0 ? 3 : 1),
                0,
            );
        return (10 - (sum % 10)) % 10 === checkDigit;
    }

    private assertBarcodeFormat(code: string, type: BarcodeType) {
        const length = GTIN_LENGTH[String(type)];
        if (!length) return;
        if (
            !new RegExp(`^\\d{${length}}$`).test(code) ||
            !this.gtinChecksumValid(code)
        ) {
            throw new BadRequestException(
                this.t("catalog.barcode.invalid", { code, type }),
            );
        }
    }

    /**
     * Normalizes barcode input into rows ready for persistence. Exactly one
     * barcode ends up primary (the flagged one, else the first). `type`
     * defaults to EAN13 and GTIN types are checksum-validated.
     */
    private barcodeRows(barcodes?: BarcodeInput[]) {
        if (!barcodes?.length) return [];
        const flaggedCount = barcodes.filter(
            (barcode) => barcode.isPrimary,
        ).length;
        if (flaggedCount > 1) {
            throw new BadRequestException(
                this.t("catalog.barcode.multiplePrimary"),
            );
        }
        return barcodes.map((barcode, index) => {
            const type = barcode.type ?? ("EAN13" as BarcodeType);
            this.assertBarcodeFormat(barcode.code, type);
            return {
                code: barcode.code,
                type,
                isPrimary: flaggedCount ? !!barcode.isPrimary : index === 0,
            };
        });
    }

    /** Validates barcode input of several variants; returns all codes (no duplicates allowed). */
    private assertVariantBarcodes(inputs: { barcodes?: BarcodeInput[] }[]) {
        const codes: string[] = [];
        const seen = new Set<string>();
        for (const input of inputs) {
            this.barcodeRows(input.barcodes);
            for (const barcode of input.barcodes ?? []) {
                if (seen.has(barcode.code)) {
                    throw new BadRequestException(
                        this.t("catalog.barcode.duplicate", {
                            code: barcode.code,
                        }),
                    );
                }
                seen.add(barcode.code);
                codes.push(barcode.code);
            }
        }
        return codes;
    }

    /** A barcode may belong to only one live variant. */
    private async assertBarcodesFree(
        codes: string[],
        excludeVariantIds: bigint[] = [],
    ) {
        if (!codes.length) return;
        const clash = await this.prisma.productBarcode.findFirst({
            where: {
                code: { in: codes },
                variant: { deletedAt: null },
                ...(excludeVariantIds.length
                    ? { variantId: { notIn: excludeVariantIds } }
                    : {}),
            },
            select: { code: true },
        });
        if (clash) {
            throw new ConflictException(
                this.t("catalog.barcode.exists", { code: clash.code }),
            );
        }
    }

    // ============ variant building ============

    /**
     * Validates variant definitions against the product's option types and
     * computes the data needed to persist each variant.
     *
     *  - At most {@link MAX_VARIANTS} variants.
     *  - More than one variant requires at least one option type.
     *  - Explicit SKUs must be unique within the request.
     *  - Each variant supplies exactly one option value per option type, all
     *    existing and matching the product's option types.
     *  - No two variants share the same option combination.
     *  - Option image overrides must reference one of the variant's values.
     */
    private async buildVariantRows(
        optionGroupIds: bigint[],
        variantInputs: VariantInput[],
    ): Promise<VariantRow[]> {
        if (variantInputs.length > MAX_VARIANTS) {
            throw new BadRequestException(
                this.t("catalog.variant.limit", { max: MAX_VARIANTS }),
            );
        }
        if (!optionGroupIds.length && variantInputs.length > 1) {
            throw new BadRequestException(
                this.t("catalog.variant.optionsRequired"),
            );
        }

        const requestedValueIds = variantInputs
            .flatMap((variant) => variant.optionValueIds ?? [])
            .map(BigInt);
        const optionValues = requestedValueIds.length
            ? await this.options.findValuesByIds(requestedValueIds)
            : [];
        const optionValueById = new Map(
            optionValues.map((value) => [value.id.toString(), value]),
        );

        const seenHashes = new Set<string>();
        const seenSkus = new Set<string>();

        return variantInputs.map((variantInput, index) => {
            const label = variantInput.sku || `#${index + 1}`;

            if (variantInput.sku) {
                if (seenSkus.has(variantInput.sku)) {
                    throw new BadRequestException(
                        this.t("catalog.variant.duplicateSku", {
                            sku: variantInput.sku,
                        }),
                    );
                }
                seenSkus.add(variantInput.sku);
            }

            const valueIds = (variantInput.optionValueIds ?? []).map(BigInt);
            if (valueIds.length !== optionGroupIds.length) {
                throw new BadRequestException(
                    this.t("catalog.variant.optionValueCount", {
                        sku: label,
                        count: optionGroupIds.length,
                    }),
                );
            }

            const valueIdByGroup = new Map<string, bigint>();
            for (const valueId of valueIds) {
                const optionValue = optionValueById.get(valueId.toString());
                if (!optionValue) {
                    throw new BadRequestException(
                        this.t("catalog.variant.unknownOptionValue", {
                            sku: label,
                        }),
                    );
                }
                valueIdByGroup.set(
                    optionValue.optionGroupId.toString(),
                    optionValue.id,
                );
            }

            const orderedValueIds = optionGroupIds.map((groupId) =>
                valueIdByGroup.get(groupId.toString()),
            );
            if (orderedValueIds.some((valueId) => !valueId)) {
                throw new BadRequestException(
                    this.t("catalog.variant.optionMismatch", { sku: label }),
                );
            }

            const optionHash = orderedValueIds.length
                ? orderedValueIds.join("-")
                : "default";
            if (seenHashes.has(optionHash)) {
                throw new BadRequestException(
                    this.t("catalog.variant.duplicateCombination", {
                        sku: label,
                    }),
                );
            }
            seenHashes.add(optionHash);

            const imageByValueId = new Map<string, bigint>();
            for (const override of variantInput.optionImages ?? []) {
                const valueKey = String(override.optionValueId);
                if (
                    !valueIds.some((valueId) => valueId.toString() === valueKey)
                ) {
                    throw new BadRequestException(
                        this.t("catalog.variant.optionImageMismatch", {
                            sku: label,
                        }),
                    );
                }
                imageByValueId.set(valueKey, BigInt(override.mediaId));
            }

            return {
                variantInput,
                optionHash,
                optionLinks: optionGroupIds.map((optionGroupId, position) => ({
                    optionGroupId,
                    optionValueId: orderedValueIds[position]!,
                    imageId:
                        imageByValueId.get(
                            orderedValueIds[position]!.toString(),
                        ) ?? null,
                })),
                optionCodes: orderedValueIds.map((valueId) =>
                    this.optionValueCode(
                        optionValueById.get(valueId!.toString())!,
                    ),
                ),
            };
        });
    }

    /** Rebuilds a VariantDto from a stored variant (kept / remapped variants). */
    private variantInputFromRow(variant: VariantScalars): VariantInput {
        return {
            sku: variant.sku,
            mrp: Number(variant.mrp),
            unit: variant.unit ?? undefined,
            unitValue:
                variant.unitValue == null
                    ? undefined
                    : Number(variant.unitValue),
            weightGrams: variant.weightGrams ?? undefined,
            position: variant.position,
            isActive: variant.isActive,
            audioMediaId: variant.audioMediaId,
            optionValueIds: [],
        };
    }

    // ============ CREATE ============

    /**
     * Creates a product with translations, option types, gallery and variants
     * (barcodes, option images, media) in one transaction.
     *
     *  - `status` DRAFT (default): only one of title / category / variant is
     *    required; structural rules (SKU / barcode uniqueness, option
     *    combinations, media types) still apply.
     *  - `status` PUBLISHED: the publish rules are checked inside the
     *    transaction, so nothing is saved when one fails (400 lists them all).
     *  - Missing SKUs are generated; the slug is generated from the title
     *    when not sent; the first gallery image becomes the thumbnail.
     *
     * @throws ConflictException if the slug, a SKU or a barcode is already taken.
     */
    async createProduct(dto: CreateProductInput, actorId: bigint) {
        const translations = dto.translations ?? [];
        const status = dto.status ?? ProductStatus.DRAFT;

        this.assertHasDraftContent(dto);
        this.assertTranslationsValid(translations);
        this.assertNutritionTables(translations);
        await this.assertCategoryAndBrand(dto.categoryId, dto.brandId);

        // No option types -> simple product (one variant, no option values).
        const optionGroupIds = (dto.optionGroupIds ?? []).map(BigInt);
        const variantInputs: VariantInput[] = (dto.variants ?? []).map(
            (variant) =>
                optionGroupIds.length
                    ? { ...variant }
                    : { ...variant, optionValueIds: [], optionImages: [] },
        );

        await this.options.assertGroupsExist(optionGroupIds);
        const variantRows = await this.buildVariantRows(
            optionGroupIds,
            variantInputs,
        );

        await this.assertMedia({
            gallery: dto.mediaIds,
            audioId: dto.audioMediaId,
            variantMedia: variantInputs.map((variant) => variant.mediaIds),
            variantAudio: variantInputs.map((variant) => variant.audioMediaId),
            optionImages: variantInputs.flatMap((variant) =>
                (variant.optionImages ?? []).map((item) => item.mediaId),
            ),
        });
        await this.assertBarcodesFree(
            this.assertVariantBarcodes(variantInputs),
        );

        const title = this.pickTitle(translations);
        let slug: string;
        if (dto.slug) {
            await this.assertSlugFree(dto.slug);
            slug = dto.slug;
        } else {
            slug = await this.uniqueSlug(this.slugBase(title));
        }

        await this.assignMissingSkus(variantRows, title || slug);
        await this.assertSkusFree(
            variantRows.map((row) => row.variantInput.sku!),
        );

        const gallery = (dto.mediaIds ?? []).map(BigInt);
        const createdProduct = await this.prisma
            .$transaction(async (tx) => {
                const product = await tx.product.create({
                    data: {
                        slug,
                        categoryId: dto.categoryId ?? null,
                        brandId: dto.brandId ?? null,
                        thumbnailId: gallery[0] ?? null,
                        audioMediaId: dto.audioMediaId ?? null,
                        status,
                        publishedAt:
                            status === ProductStatus.PUBLISHED
                                ? new Date()
                                : null,
                        dietType: dto.dietType,
                        hsnCode: dto.hsnCode,
                        gstRate: dto.gstRate ?? 0,
                        countryOfOrigin: dto.countryOfOrigin,
                        shelfLifeDays: dto.shelfLifeDays,
                        isPerishable: dto.isPerishable ?? false,
                        manufacturerName: dto.manufacturerName,
                        nutrition: this.json(dto.nutrition),
                        createdById: actorId,
                        translations: {
                            create: translations.map((translation) => ({
                                lang: translation.lang,
                                ...this.translationData(translation),
                                searchText: "",
                            })),
                        },
                        options: {
                            create: optionGroupIds.map(
                                (optionGroupId, position) => ({
                                    optionGroupId,
                                    position,
                                }),
                            ),
                        },
                        media: {
                            create: gallery.map((mediaId, position) => ({
                                mediaId,
                                position,
                            })),
                        },
                    },
                });

                for (const [index, row] of variantRows.entries()) {
                    await this.createVariantTx(tx, product.id, row, index);
                }
                await this.rebuildSearchTextTx(tx, product.id);
                if (status === ProductStatus.PUBLISHED) {
                    await this.assertPublishableTx(tx, product.id);
                }
                return product;
            }, LONG_TRANSACTION)
            .catch((error) => this.rethrow(error));

        if (status === ProductStatus.PUBLISHED) await this.cache.bustAll();
        else await this.cache.bust();
        return this.adminGet(createdProduct.id);
    }

    /** Option link columns; `imageId` is only written when an override is set. */
    private optionLinkData(link: VariantRow["optionLinks"][number]) {
        return {
            optionGroupId: link.optionGroupId,
            optionValueId: link.optionValueId,
            ...(link.imageId != null ? { imageId: link.imageId } : {}),
        };
    }

    /** Persists one validated variant row (from {@link buildVariantRows}). */
    private async createVariantTx(
        tx: Db,
        productId: bigint,
        row: VariantRow,
        fallbackPosition: number,
    ) {
        const { variantInput } = row;
        const createdVariant = await tx.productVariant.create({
            data: {
                // Relation `connect` (not the `productId` scalar): if any other
                // field is rejected, Prisma then names that field instead of
                // the misleading "Argument `product` is missing".
                product: { connect: { id: productId } },
                sku: variantInput.sku!,
                optionHash: row.optionHash,
                mrp: variantInput.mrp,
                unit: variantInput.unit,
                unitValue: variantInput.unitValue,
                weightGrams: variantInput.weightGrams,
                position: variantInput.position ?? fallbackPosition,
                isActive: variantInput.isActive ?? true,
                ...(variantInput.audioMediaId != null
                    ? {
                          audioMedia: {
                              connect: {
                                  id: BigInt(variantInput.audioMediaId),
                              },
                          },
                      }
                    : {}),
                optionValues: {
                    create: row.optionLinks.map((link) =>
                        this.optionLinkData(link),
                    ),
                },
                barcodes: { create: this.barcodeRows(variantInput.barcodes) },
            },
        });

        if (variantInput.mediaIds?.length) {
            await tx.productMedia.createMany({
                data: variantInput.mediaIds.map((mediaId, position) => ({
                    productId,
                    variantId: createdVariant.id,
                    mediaId,
                    position,
                })),
            });
        }

        return createdVariant;
    }

    // ============ READ (admin) ============

    /**
     * Full admin representation of a product plus `isVariable` and
     * `publishIssues` (what is still missing to publish; empty = ready).
     *
     * @throws NotFoundException if the product does not exist or is deleted.
     */
    async adminGet(id: bigint) {
        const product = await this.findProductDetail({ id, deletedAt: null });
        const publishIssues = await this.publishProblems(this.prisma, id);
        return {
            ...product,
            isVariable: product.options.length > 0,
            publishIssues,
        };
    }

    /**
     * Store-facing product detail (store managers / staff). Only PUBLISHED,
     * non-deleted products are visible; anything else answers 404.
     */
    async storeGet(id: bigint) {
        return this.findProductDetail({
            id,
            deletedAt: null,
            status: ProductStatus.PUBLISHED,
        });
    }

    // ============ STORE MANAGER: own product / variant photos ============

    /**
     * Appends photos to a PUBLISHED product's gallery, or to one of its
     * variants. Only READY images with purpose PRODUCT uploaded by `userId`;
     * existing media (anyone's) is never moved or removed. Already-attached
     * ids are skipped. A product without a thumbnail gets the first new photo.
     */
    async storeAddMedia(userId: bigint, productId: bigint, mediaIds: bigint[], variantId?: bigint) {
        const product = await this.prisma.product.findFirst({
            where: { id: productId, deletedAt: null, status: ProductStatus.PUBLISHED },
            select: { id: true, thumbnailId: true },
        });
        if (!product) throw new NotFoundException(this.t("catalog.product.notFound"));

        if (variantId !== undefined) {
            const variant = await this.prisma.productVariant.findFirst({
                where: { id: variantId, productId, deletedAt: null },
                select: { id: true },
            });
            if (!variant) throw new NotFoundException(this.t("catalog.variant.notFound"));
        }

        const ids = [...new Set(mediaIds.map(String))].map(BigInt);
        const files = await this.prisma.mediaFile.findMany({
            where: { id: { in: ids }, deletedAt: null },
            select: { id: true, uploadedById: true, purpose: true, type: true, status: true },
        });
        const byId = new Map(files.map((file) => [file.id.toString(), file]));

        for (const id of ids) {
            const file = byId.get(id.toString());
            if (!file) throw new BadRequestException(this.t("catalog.media.notFound"));
            if (file.uploadedById !== userId) throw new ForbiddenException(this.t("catalog.media.notYours"));
            if (file.purpose !== "PRODUCT" || file.type !== "IMAGE" || file.status !== "READY") {
                throw new BadRequestException(this.t("catalog.media.notProductImage"));
            }
        }

        const scope = variantId !== undefined ? { variantId } : { productId, variantId: null };
        const existing = await this.prisma.productMedia.findMany({
            where: scope,
            orderBy: { position: "asc" },
            select: { mediaId: true, position: true },
        });
        const attached = new Set(existing.map((row) => row.mediaId.toString()));
        const fresh = ids.filter((id) => !attached.has(id.toString()));
        const max = variantId !== undefined ? MAX_VARIANT_MEDIA : MAX_GALLERY_ITEMS;

        if (existing.length + fresh.length > max) {
            throw new BadRequestException(
                this.t(variantId !== undefined ? "catalog.media.variantLimit" : "catalog.media.galleryLimit", { max }),
            );
        }

        const start = existing.reduce((top, row) => Math.max(top, row.position + 1), 0);
        const setThumbnail = variantId === undefined && !product.thumbnailId && fresh.length > 0;

        await this.prisma.$transaction(async (tx) => {
            if (fresh.length) {
                await tx.productMedia.createMany({
                    data: fresh.map((mediaId, index) => ({
                        productId,
                        variantId: variantId ?? null,
                        mediaId,
                        position: start + index,
                    })),
                });
            }
            if (setThumbnail) {
                await tx.product.update({ where: { id: productId }, data: { thumbnailId: fresh[0] } });
            }
        });

        if (fresh.length) {
            await this.cache.bustProduct(productId);
            if (setThumbnail) await this.cache.bustAll();
        }

        return {
            productId,
            variantId: variantId ?? null,
            added: fresh,
            skipped: ids.filter((id) => attached.has(id.toString())),
        };
    }

    /**
     * Detaches a photo the manager uploaded from the product gallery and every
     * variant of the product. Photos uploaded by others cannot be removed. If
     * it was the thumbnail, the next gallery image takes its place.
     */
    async storeRemoveMedia(userId: bigint, productId: bigint, mediaId: bigint) {
        const product = await this.prisma.product.findFirst({
            where: { id: productId, deletedAt: null, status: ProductStatus.PUBLISHED },
            select: { id: true, thumbnailId: true },
        });
        if (!product) throw new NotFoundException(this.t("catalog.product.notFound"));

        const file = await this.prisma.mediaFile.findUnique({ where: { id: mediaId }, select: { uploadedById: true } });
        if (!file) throw new NotFoundException(this.t("catalog.media.notFound"));
        if (file.uploadedById !== userId) throw new ForbiddenException(this.t("catalog.media.notYours"));

        const wasThumbnail = product.thumbnailId === mediaId;

        const removed = await this.prisma.$transaction(async (tx) => {
            const { count } = await tx.productMedia.deleteMany({ where: { productId, mediaId } });
            if (!count) throw new NotFoundException(this.t("catalog.media.notInProduct"));

            if (wasThumbnail) {
                const next = await tx.productMedia.findFirst({
                    where: { productId, variantId: null, media: { type: "IMAGE", deletedAt: null } },
                    orderBy: { position: "asc" },
                    select: { mediaId: true },
                });
                await tx.product.update({ where: { id: productId }, data: { thumbnailId: next?.mediaId ?? null } });
            }

            return count;
        });

        await this.cache.bustProduct(productId);
        if (wasThumbnail) await this.cache.bustAll();

        return { success: true, productId, mediaId, removed };
    }

    private async findProductDetail(where: Prisma.ProductWhereInput) {
        const product = await this.prisma.product.findFirst({
            where,
            include: PRODUCT_DETAIL_INCLUDE,
        });
        if (!product) this.notFound();
        return product;
    }

    /**
     * Category ids allowed by `categoryId` / `categoryIds` / `groupIds`
     * (sub-categories included), or null when none is set. [] = no match.
     */
    private categoryFilter(query: ListProductsInput) {
        const categoryIds = [
            ...(query.categoryIds ?? []),
            ...(query.categoryId ? [query.categoryId] : []),
        ];
        return this.categories.resolveFilter({
            categoryIds,
            groupIds: query.groupIds,
        });
    }

    /** Brand ids from `brandId` / `brandIds`, or null when none is set. */
    private brandFilter(query: ListProductsInput): bigint[] | null {
        const ids = [
            ...(query.brandIds ?? []),
            ...(query.brandId ? [query.brandId] : []),
        ];
        return ids.length ? ids : null;
    }

    /**
     * Prisma `where` for the admin list. Keep in sync with
     * {@link buildAdminWhereSql}.
     */
    private buildAdminWhere(
        query: ListProductsInput,
        searchTokens: string[],
        categoryIds: bigint[] | null,
    ): Prisma.ProductWhereInput {
        const variantFilters: Prisma.ProductWhereInput[] = [];

        // SKU / barcode filters only make sense on live variants.
        if (query.sku && !query.deleted) {
            variantFilters.push({
                variants: {
                    some: {
                        deletedAt: null,
                        sku: { contains: query.sku, mode: "insensitive" },
                    },
                },
            });
        }
        if (query.barcode && !query.deleted) {
            variantFilters.push({
                variants: {
                    some: {
                        deletedAt: null,
                        barcodes: {
                            some: {
                                code: {
                                    contains: query.barcode,
                                    mode: "insensitive",
                                },
                            },
                        },
                    },
                },
            });
        }
        if (query.type === "variable") {
            variantFilters.push({ options: { some: {} } });
        } else if (query.type === "simple") {
            variantFilters.push({ options: { none: {} } });
        }

        return {
            deletedAt: query.deleted ? { not: null } : null,
            ...(query.status ? { status: query.status } : {}),
            ...(categoryIds ? { categoryId: { in: categoryIds } } : {}),
            ...(this.brandFilter(query)
                ? { brandId: { in: this.brandFilter(query)! } }
                : {}),
            ...(query.excludeIds?.length
                ? { id: { notIn: query.excludeIds } }
                : {}),
            ...(query.storeId
                ? { storeProducts: { some: { storeId: query.storeId } } }
                : {}),
            ...(searchTokens.length
                ? {
                      translations: {
                          some: {
                              AND: searchTokens.map((token) => ({
                                  searchText: {
                                      contains: token,
                                      mode: "insensitive" as const,
                                  },
                              })),
                          },
                      },
                  }
                : {}),
            ...(variantFilters.length ? { AND: variantFilters } : {}),
        };
    }

    /** The same filters as {@link buildAdminWhere}, as raw SQL on `"Product" p`. */
    private buildAdminWhereSql(
        query: ListProductsInput,
        searchTokens: string[],
        categoryIds: bigint[] | null,
    ): Prisma.Sql {
        const conditions: Prisma.Sql[] = [
            query.deleted
                ? Prisma.sql`p."deletedAt" IS NOT NULL`
                : Prisma.sql`p."deletedAt" IS NULL`,
        ];

        if (query.status) {
            conditions.push(Prisma.sql`p."status"::text = ${query.status}`);
        }
        if (categoryIds) {
            conditions.push(
                categoryIds.length
                    ? Prisma.sql`p."categoryId" IN (${Prisma.join(categoryIds)})`
                    : Prisma.sql`FALSE`,
            );
        }
        const brandIds = this.brandFilter(query);
        if (brandIds) {
            conditions.push(Prisma.sql`p."brandId" IN (${Prisma.join(brandIds)})`);
        }
        if (query.excludeIds?.length) {
            conditions.push(
                Prisma.sql`p."id" NOT IN (${Prisma.join(query.excludeIds)})`,
            );
        }
        if (query.storeId) {
            conditions.push(Prisma.sql`EXISTS (
                SELECT 1 FROM "StoreProduct" sp
                WHERE sp."productId" = p.id
                  AND sp."storeId" = ${query.storeId}
            )`);
        }
        if (query.type) {
            const hasOptions = Prisma.sql`EXISTS (
                SELECT 1 FROM "ProductOption" po WHERE po."productId" = p.id
            )`;
            conditions.push(
                query.type === "variable"
                    ? hasOptions
                    : Prisma.sql`NOT ${hasOptions}`,
            );
        }
        if (query.sku && !query.deleted) {
            conditions.push(Prisma.sql`EXISTS (
                SELECT 1 FROM "ProductVariant" v
                WHERE v."productId" = p.id
                  AND v."deletedAt" IS NULL
                  AND v.sku ILIKE ${`%${query.sku}%`}
            )`);
        }
        if (query.barcode && !query.deleted) {
            conditions.push(Prisma.sql`EXISTS (
                SELECT 1 FROM "ProductBarcode" b
                JOIN "ProductVariant" v ON v.id = b."variantId"
                WHERE v."productId" = p.id
                  AND v."deletedAt" IS NULL
                  AND b.code ILIKE ${`%${query.barcode}%`}
            )`);
        }
        for (const token of searchTokens) {
            conditions.push(Prisma.sql`EXISTS (
                SELECT 1 FROM "ProductTranslation" st
                WHERE st."productId" = p.id
                  AND st."searchText" ILIKE ${`%${token}%`}
            )`);
        }

        return Prisma.join(conditions, " AND ");
    }

    /**
     * Resolves one ordered page of product ids in SQL for the sorts Prisma
     * cannot express (`name_*`, `price_*`). `null` = plain Prisma sort.
     */
    private async sortedIdsBySql(
        query: ListProductsInput,
        searchTokens: string[],
        categoryIds: bigint[] | null,
        take: number,
        skip: number,
    ): Promise<bigint[] | null> {
        if (!query.sort || !SQL_SORTS.includes(query.sort)) return null;

        const sort = query.sort as SqlSort;
        const direction = sort.endsWith("_asc")
            ? Prisma.sql`ASC`
            : Prisma.sql`DESC`;
        const whereSql = this.buildAdminWhereSql(
            query,
            searchTokens,
            categoryIds,
        );

        let joinSql: Prisma.Sql;
        let orderSql: Prisma.Sql;
        if (sort.startsWith("name")) {
            joinSql = Prisma.sql`LEFT JOIN "ProductTranslation" pt
                ON pt."productId" = p.id AND pt.lang = ${this.locale.defaultLanguage}`;
            orderSql = Prisma.sql`ORDER BY COALESCE(pt.title, '') ${direction}, p.id ${direction}`;
        } else {
            // The trash shows the variants that were deleted together with the product.
            const variantScope = query.deleted
                ? Prisma.sql`"deletedWithProduct" = true`
                : Prisma.sql`"deletedAt" IS NULL`;
            joinSql = Prisma.sql`LEFT JOIN (
                SELECT "productId", MIN("mrp") AS "minMrp"
                FROM "ProductVariant"
                WHERE ${variantScope}
                GROUP BY "productId"
            ) vm ON vm."productId" = p.id`;
            orderSql = Prisma.sql`ORDER BY vm."minMrp" ${direction} NULLS LAST, p.id DESC`;
        }

        const rows = await this.prisma.$queryRaw<{ id: bigint }[]>(
            Prisma.sql`
                SELECT p.id
                FROM "Product" p
                ${joinSql}
                WHERE ${whereSql}
                ${orderSql}
                LIMIT ${take} OFFSET ${skip}
            `,
        );
        return rows.map((row) => row.id);
    }

    /**
     * Price shown on a list row:
     *  - simple product   -> `{ type: "single", mrp, label }` (its variant's MRP).
     *  - variable product -> `{ type: "range", min, max, label }` (lowest - highest
     *    MRP of its variants; label collapses to one value when all are equal).
     *  - no variants yet (draft) -> `null`.
     * Active variants are used when there are any, otherwise all of them.
     */
    private listPrice(
        isVariable: boolean,
        variants: { mrp: Prisma.Decimal; isActive: boolean }[],
    ) {
        if (!variants.length) return null;
        const active = variants.filter((variant) => variant.isActive);
        const prices = (active.length ? active : variants).map((variant) =>
            num(variant.mrp),
        );

        if (!isVariable) {
            return {
                type: "single" as const,
                mrp: this.currency.format(prices[0]),
                label: this.moneyText(prices[0]),
            };
        }

        const lowest = Math.min(...prices);
        const highest = Math.max(...prices);
        return {
            type: "range" as const,
            min: this.currency.format(lowest),
            max: this.currency.format(highest),
            label:
                lowest === highest
                    ? this.moneyText(lowest)
                    : `${this.moneyText(lowest)} - ${this.moneyText(highest)}`,
        };
    }

    /**
     * Money as display text (e.g. "₹120.00") for labels. `CurrencyService.format`
     * returns an object, so its text field is used; when it has none, the
     * amount is formatted with `Intl` from the configured currency.
     */
    private moneyText(value: number): string {
        const formatted: unknown = this.currency.format(value);
        if (typeof formatted === "string") return formatted;
        if (formatted && typeof formatted === "object") {
            const fields = formatted as Record<string, unknown>;
            for (const key of ["formatted", "display", "text", "label"]) {
                if (typeof fields[key] === "string")
                    return fields[key] as string;
            }
        }
        const info = (this.currency.info ?? {}) as {
            code?: string;
            decimals?: number;
            locale?: string;
        };
        const decimals = info.decimals ?? 2;
        return new Intl.NumberFormat(info.locale ?? "en-IN", {
            style: "currency",
            currency: info.code ?? "INR",
            minimumFractionDigits: decimals,
            maximumFractionDigits: decimals,
        }).format(value);
    }

    /**
     * Paginated admin product list. Pass `deleted=true` for the trash.
     *
     * Filters: `q`, `status`, `type` (simple / variable), `categoryId` (with
     * descendants), `brandId`, `excludeIds`, `storeId`, `sku` / `barcode`
     * (live variants), `deleted`. Sort: `new`, `updated_*` (Prisma);
     * `name_*`, `price_*` (SQL).
     *
     * Rows are lean: identity, status, default-language title, category /
     * brand name, thumbnail, `price` (MRP or range) and variant SKU / MRP / primary barcode.
     */
    async adminList(query: ListProductsInput) {
        const { take, skip, page, limit } = pageParams(query);
        const searchTokens = query.q ? this.tokenize(query.q) : [];

        const categoryIds = await this.categoryFilter(query);

        const where = this.buildAdminWhere(query, searchTokens, categoryIds);
        const sqlOrderedIds = await this.sortedIdsBySql(
            query,
            searchTokens,
            categoryIds,
            take,
            skip,
        );

        const orderBy =
            query.sort === "updated_asc"
                ? { updatedAt: "asc" as const }
                : query.sort === "updated_desc"
                  ? { updatedAt: "desc" as const }
                  : { id: "desc" as const };

        const listSelect = {
            id: true,
            slug: true,
            status: true,
            categoryId: true,
            brandId: true,
            updatedAt: true,
            deletedAt: true,
            category: { select: { name: true } },
            brand: { select: { name: true } },
            thumbnail: {
                select: {
                    id: true,
                    key: true,
                    variants: true,
                    isPrivate: true,
                },
            },
            translations: {
                where: { lang: this.locale.defaultLanguage },
                select: { title: true },
            },
            variants: {
                where: query.deleted
                    ? { deletedWithProduct: true }
                    : { deletedAt: null },
                orderBy: { position: "asc" },
                select: {
                    id: true,
                    sku: true,
                    mrp: true,
                    isActive: true,
                    barcodes: {
                        where: { isPrimary: true },
                        select: { code: true },
                        take: 1,
                    },
                },
            },
            _count: { select: { options: true } },
        } satisfies Prisma.ProductSelect;

        const [rawProducts, total] = await Promise.all([
            sqlOrderedIds
                ? this.prisma.product.findMany({
                      where: { id: { in: sqlOrderedIds } },
                      select: listSelect,
                  })
                : this.prisma.product.findMany({
                      where,
                      take,
                      skip,
                      orderBy,
                      select: listSelect,
                  }),
            this.prisma.product.count({ where }),
        ]);

        const productById = new Map(
            rawProducts.map((product) => [product.id.toString(), product]),
        );
        const orderedProductIds =
            sqlOrderedIds ?? rawProducts.map((product) => product.id);
        const lang = this.locale.defaultLanguage;

        const items = orderedProductIds
            .map((productId) => productById.get(productId.toString()))
            .filter(
                (product): product is NonNullable<typeof product> =>
                    product !== undefined,
            )
            .map((product) => {
                const isVariable = product._count.options > 0;
                return {
                    id: product.id,
                    slug: product.slug,
                    title: product.translations[0]?.title ?? "",
                    status: product.status,
                    categoryId: product.categoryId,
                    categoryName: product.category
                        ? this.locale.pick(product.category.name, lang)
                        : null,
                    brandId: product.brandId,
                    brandName: product.brand
                        ? this.locale.pick(product.brand.name, lang)
                        : null,
                    isVariable,
                    variantCount: product.variants.length,
                    thumbnailId: product.thumbnail?.id ?? null,
                    thumbnailUrl: product.thumbnail
                        ? this.media.urlForVariant(product.thumbnail, "thumb")
                        : null,
                    price: this.listPrice(isVariable, product.variants),
                    variants: product.variants.map((variant) => ({
                        id: variant.id,
                        sku: variant.sku,
                        mrp: this.currency.format(variant.mrp),
                        isActive: variant.isActive,
                        barcode: variant.barcodes[0]?.code ?? null,
                    })),
                    updatedAt: product.updatedAt,
                    deletedAt: product.deletedAt,
                };
            });

        return {
            currency: this.currency.info,
            items,
            total,
            page,
            limit,
        };
    }

    /** Counts for the list's status tabs: all live, per status, and trash. */
    async adminCounts() {
        const [byStatus, trash] = await Promise.all([
            this.prisma.product.groupBy({
                by: ["status"],
                where: { deletedAt: null },
                _count: { _all: true },
            }),
            this.prisma.product.count({ where: { deletedAt: { not: null } } }),
        ]);
        const counts: Record<string, number> = {
            all: 0,
            [ProductStatus.DRAFT]: 0,
            [ProductStatus.PUBLISHED]: 0,
            [ProductStatus.ARCHIVED]: 0,
        };
        for (const row of byStatus) {
            counts[row.status] = row._count._all;
            counts.all += row._count._all;
        }
        return { ...counts, trash };
    }

    /**
     * Previously used manufacturer name + address pairs (address in `lang`),
     * most recent first; the brand's own manufacturers first when `brandId` is sent.
     */
    async manufacturerSuggestions(query: ManufacturerSuggestionInput) {
        const lang = query.lang ?? this.locale.defaultLanguage;
        const term = query.q?.replace(/[%_\\]/g, "\\$&");
        const termSql = term
            ? Prisma.sql`AND (p."manufacturerName" ILIKE ${`%${term}%`} OR pt."manufacturerAddress" ILIKE ${`%${term}%`})`
            : Prisma.empty;
        const brandOrderSql = query.brandId
            ? Prisma.sql`MAX(CASE WHEN p."brandId" = ${query.brandId} THEN 1 ELSE 0 END) DESC,`
            : Prisma.empty;

        const items = await this.prisma.$queryRaw<
            { name: string; address: string | null }[]
        >(Prisma.sql`
            SELECT p."manufacturerName" AS name, pt."manufacturerAddress" AS address
            FROM "Product" p
            LEFT JOIN "ProductTranslation" pt
              ON pt."productId" = p.id AND pt.lang = ${lang}
            WHERE p."deletedAt" IS NULL
              AND p."manufacturerName" IS NOT NULL
              AND p."manufacturerName" <> ''
              ${termSql}
            GROUP BY p."manufacturerName", pt."manufacturerAddress"
            ORDER BY ${brandOrderSql} MAX(p."updatedAt") DESC
            LIMIT ${query.limit ?? 10}
        `);
        return { items };
    }

    // ============ UPDATE ============

    /**
     * Reconfigures a variable product's ordered option types and the
     * option-value mapping of every existing non-deleted variant (atomic).
     * Per-variant option images are kept for values that stay assigned.
     *
     * Prefer `updateProduct`, which can do this together with every other change.
     */
    async updateProductOptions(id: bigint, dto: UpdateProductOptionsInput) {
        const product = await this.prisma.product.findFirst({
            where: { id, deletedAt: null },
            include: {
                options: { select: { id: true } },
                variants: {
                    where: { deletedAt: null },
                    include: {
                        optionValues: {
                            select: { optionValueId: true, imageId: true },
                        },
                    },
                },
            },
        });
        if (!product) this.notFound();
        if (!product.options.length) {
            throw new BadRequestException(
                this.t("catalog.product.notVariable"),
            );
        }

        const currentVariantIds = new Set(
            product.variants.map((variant) => variant.id.toString()),
        );
        const suppliedVariantIds = dto.variants.map((variant) =>
            variant.id.toString(),
        );
        if (
            suppliedVariantIds.length !== currentVariantIds.size ||
            suppliedVariantIds.some(
                (variantId) => !currentVariantIds.has(variantId),
            )
        ) {
            throw new BadRequestException(
                this.t("catalog.variant.optionAssignmentsRequired"),
            );
        }

        const optionGroupIds = dto.optionGroupIds.map(BigInt);
        if (!optionGroupIds.length) {
            throw new BadRequestException(
                this.t("catalog.product.optionGroupsRequired"),
            );
        }

        const optionValueIdsByVariant = new Map(
            dto.variants.map((variant) => [
                String(variant.id),
                variant.optionValueIds.map(String),
            ]),
        );
        const variantInputs: VariantInput[] = product.variants.map((variant) => {
            const newValueIds =
                optionValueIdsByVariant.get(variant.id.toString()) ?? [];
            return {
                ...this.variantInputFromRow(variant),
                optionValueIds: newValueIds.map(BigInt),
                optionImages: variant.optionValues
                    .filter(
                        (link) =>
                            link.imageId &&
                            newValueIds.includes(link.optionValueId.toString()),
                    )
                    .map((link) => ({
                        optionValueId: link.optionValueId,
                        mediaId: link.imageId!,
                    })),
            };
        });

        await this.options.assertGroupsExist(optionGroupIds);
        const variantRows = await this.buildVariantRows(
            optionGroupIds,
            variantInputs,
        );

        const variantIds = product.variants.map((variant) => variant.id);
        const hashConflict = await this.prisma.productVariant.findFirst({
            where: {
                productId: id,
                id: { notIn: variantIds },
                optionHash: { in: variantRows.map((row) => row.optionHash) },
            },
            select: { id: true },
        });
        if (hashConflict) {
            throw new ConflictException(
                this.t("catalog.variant.combinationExists"),
            );
        }

        await this.prisma
            .$transaction(async (tx) => {
                await this.lockProductTx(tx, id, product.updatedAt);
                await tx.productOption.deleteMany({ where: { productId: id } });
                await tx.productOption.createMany({
                    data: optionGroupIds.map((optionGroupId, position) => ({
                        productId: id,
                        optionGroupId,
                        position,
                    })),
                });

                // Park current hashes so valid swaps cannot hit the unique constraint.
                for (const variant of product.variants) {
                    await tx.productVariant.update({
                        where: { id: variant.id },
                        data: {
                            optionHash: `__rebuild-${id}-${variant.id}-${randomToken(3)}`,
                        },
                    });
                }
                await tx.variantOptionValue.deleteMany({
                    where: { variantId: { in: variantIds } },
                });

                for (const [index, row] of variantRows.entries()) {
                    const variantId = product.variants[index].id;
                    if (row.optionLinks.length) {
                        await tx.variantOptionValue.createMany({
                            data: row.optionLinks.map((link) => ({
                                variantId,
                                ...this.optionLinkData(link),
                            })),
                        });
                    }
                    await tx.productVariant.update({
                        where: { id: variantId },
                        data: { optionHash: row.optionHash },
                    });
                }
                await this.assertStillPublishableTx(tx, id);
            })
            .catch((error) => this.rethrow(error));

        await this.cache.bustAll();
        return this.adminGet(id);
    }

    /**
     * Works out how the product's variants must change for an update.
     * Returns `null` when the request does not touch the variant structure.
     *
     *  - Simple: option values are ignored; at most one variant. Switching from
     *    variable without `variants` keeps the first active variant.
     *  - Variable: switching from simple, or changing option types, requires
     *    `variants` when the product already has variants.
     *  - `variants` is a full list: with `id` = edit, without = add, missing =
     *    soft-deleted. An edited variant without `sku` keeps its SKU; a new
     *    one without `sku` gets a generated one.
     */
    private async planVariantSync(
        currentProduct: ProductWithStructure,
        dto: UpdateProductInput,
        skuSource: string,
    ): Promise<VariantSyncPlan | null> {
        const currentOptionGroupIds = currentProduct.options.map(
            (option) => option.optionGroupId,
        );
        const optionGroupIds =
            dto.optionGroupIds !== undefined
                ? dto.optionGroupIds.map(BigInt)
                : currentOptionGroupIds;
        const isVariable = optionGroupIds.length > 0;
        const isSwitchingKind = isVariable !== currentOptionGroupIds.length > 0;
        const optionsChanged =
            optionGroupIds.map(String).join(",") !==
            currentOptionGroupIds.map(String).join(",");
        const currentVariantById = new Map(
            currentProduct.variants.map((variant) => [
                variant.id.toString(),
                variant,
            ]),
        );

        let variantRequests: { variantInput: VariantInput; id?: bigint }[];

        if (dto.variants !== undefined) {
            variantRequests = dto.variants.map((variant) => {
                const id = variant.id != null ? BigInt(variant.id) : undefined;
                const current =
                    id !== undefined
                        ? currentVariantById.get(id.toString())
                        : undefined;
                return {
                    id,
                    variantInput: {
                        ...variant,
                        sku: variant.sku ?? current?.sku,
                        ...(isVariable
                            ? {}
                            : { optionValueIds: [], optionImages: [] }),
                    },
                };
            });
        } else if (!isVariable && isSwitchingKind) {
            const variantToKeep =
                currentProduct.variants.find((variant) => variant.isActive) ??
                currentProduct.variants[0];
            variantRequests = variantToKeep
                ? [
                      {
                          id: variantToKeep.id,
                          variantInput: this.variantInputFromRow(variantToKeep),
                      },
                  ]
                : [];
        } else if (
            isVariable &&
            (isSwitchingKind || optionsChanged) &&
            currentProduct.variants.length
        ) {
            throw new BadRequestException(
                this.t(
                    isSwitchingKind
                        ? "catalog.variant.minimumRequired"
                        : "catalog.variant.optionAssignmentsRequired",
                ),
            );
        } else if (optionsChanged) {
            // No variants yet (draft): only the option types change.
            variantRequests = [];
        } else {
            return null;
        }

        await this.options.assertGroupsExist(optionGroupIds);

        // Every supplied id must be an existing variant and appear only once.
        const keptVariantIds = new Set<string>();
        for (const { id } of variantRequests) {
            if (id === undefined) continue;
            const key = id.toString();
            if (!currentVariantById.has(key)) {
                throw new NotFoundException(this.t("catalog.variant.notFound"));
            }
            if (keptVariantIds.has(key)) {
                throw new BadRequestException(
                    this.t("catalog.variant.duplicateId"),
                );
            }
            keptVariantIds.add(key);
        }

        const builtRows = await this.buildVariantRows(
            optionGroupIds,
            variantRequests.map((request) => request.variantInput),
        );
        const rows: VariantSyncRow[] = builtRows.map((row, index) => ({
            ...row,
            id: variantRequests[index].id,
        }));

        const removeIds = currentProduct.variants
            .filter((variant) => !keptVariantIds.has(variant.id.toString()))
            .map((variant) => variant.id);
        const survivingIds = rows
            .filter((row) => row.id !== undefined)
            .map((row) => row.id!);

        await this.assignMissingSkus(rows, skuSource, currentProduct.id);
        await this.assertSkusFree(
            rows.map((row) => row.variantInput.sku!),
            [...survivingIds, ...removeIds],
        );

        // Barcodes of removed variants and of variants whose barcodes are replaced are freed.
        const codes = this.assertVariantBarcodes(
            rows.map((row) => row.variantInput),
        );
        const replacedOwners = rows
            .filter(
                (row) =>
                    row.id !== undefined &&
                    row.variantInput.barcodes !== undefined,
            )
            .map((row) => row.id!);
        await this.assertBarcodesFree(codes, [...replacedOwners, ...removeIds]);

        return { isVariable, optionGroupIds, optionsChanged, rows, removeIds };
    }

    /**
     * Applies a {@link VariantSyncPlan} inside the caller's transaction.
     *
     *  1. Soft-deletes removed variants (option links and media removed).
     *  2. Rewrites the option types when they changed.
     *  3. Clears option links of surviving variants and parks changed
     *     SKU / option hash on temporary values (no unique clashes mid-way).
     *  4. Edits surviving variants and creates new ones.
     */
    private async applyVariantSyncTx(
        tx: Db,
        productId: bigint,
        plan: VariantSyncPlan,
        currentVariants: ProductWithStructure["variants"],
    ) {
        const currentVariantById = new Map(
            currentVariants.map((variant) => [variant.id.toString(), variant]),
        );

        // 1. delete removed variants
        for (const variantId of plan.removeIds) {
            await this.softDeleteVariantTx(tx, variantId);
        }
        if (plan.removeIds.length) {
            await tx.variantOptionValue.deleteMany({
                where: { variantId: { in: plan.removeIds } },
            });
            await tx.productMedia.deleteMany({
                where: { variantId: { in: plan.removeIds } },
            });
        }

        // 2. product option types
        if (plan.optionsChanged) {
            await tx.productOption.deleteMany({ where: { productId } });
            if (plan.optionGroupIds.length) {
                await tx.productOption.createMany({
                    data: plan.optionGroupIds.map(
                        (optionGroupId, position) => ({
                            productId,
                            optionGroupId,
                            position,
                        }),
                    ),
                });
            }
        }

        // 3. detach links, park changed SKU / hash
        const keptRows = plan.rows.filter((row) => row.id !== undefined);
        if (keptRows.length) {
            await tx.variantOptionValue.deleteMany({
                where: { variantId: { in: keptRows.map((row) => row.id!) } },
            });
        }
        for (const row of keptRows) {
            const currentVariant = currentVariantById.get(row.id!.toString())!;
            const identityChanged =
                currentVariant.sku !== row.variantInput.sku ||
                currentVariant.optionHash !== row.optionHash;
            if (identityChanged) {
                await tx.productVariant.update({
                    where: { id: row.id! },
                    data: {
                        sku: `__tmp-${row.id}-${randomToken(3)}`,
                        optionHash: `__tmp-${row.id}-${randomToken(3)}`,
                    },
                });
            }
        }

        // 4. edit existing / create new
        for (const [index, row] of plan.rows.entries()) {
            if (row.id === undefined) {
                await this.createVariantTx(tx, productId, row, index);
                continue;
            }
            await tx.productVariant.update({
                where: { id: row.id },
                data: {
                    sku: row.variantInput.sku!,
                    optionHash: row.optionHash,
                },
            });
            await this.applyVariantUpdateTx(tx, productId, row.id, {
                ...row.variantInput,
                position: row.variantInput.position ?? index,
            });
            if (row.optionLinks.length) {
                await tx.variantOptionValue.createMany({
                    data: row.optionLinks.map((link) => ({
                        variantId: row.id!,
                        ...this.optionLinkData(link),
                    })),
                });
            }
        }
    }

    /**
     * Updates a product the same way it was created: product fields,
     * translations, gallery, option types, full variant list and status in
     * ONE transaction.
     *
     *  - Only the fields that are sent change. A category can be changed but
     *    not cleared once set; a new category / brand must be ACTIVE.
     *  - Translations are upserted per language.
     *  - `mediaIds` replaces the gallery; its first image becomes the thumbnail.
     *  - `optionGroupIds`: omitted = keep, `[]` = simple, non-empty = variable.
     *  - `variants`: id = edit, no id = add, missing = soft delete.
     *  - `status`: when the resulting status is PUBLISHED (sent or current),
     *    every publish rule is enforced and a failing edit is rolled back.
     */
    async updateProduct(id: bigint, dto: UpdateProductInput) {
        const currentProduct = await this.prisma.product.findFirst({
            where: { id, deletedAt: null },
            include: {
                options: { orderBy: { position: "asc" } },
                variants: {
                    where: { deletedAt: null },
                    orderBy: [{ position: "asc" }, { id: "asc" }],
                },
            },
        });
        if (!currentProduct) this.notFound();

        // Fail fast when the form is stale (re-checked under the lock below).
        if (
            dto.expectedUpdatedAt &&
            currentProduct.updatedAt.getTime() !==
                new Date(dto.expectedUpdatedAt).getTime()
        ) {
            throw new ConflictException(this.t("catalog.product.staleUpdate"));
        }

        const translations = dto.translations;
        if (translations) {
            this.assertTranslationsValid(translations);
            this.assertNutritionTables(translations);
        }

        // Once set, a category can be changed but not removed.
        if (dto.categoryId === null && currentProduct.categoryId) {
            throw new BadRequestException(this.t("catalog.category.required"));
        }
        const newCategoryId = dto.categoryId ?? undefined;
        const categoryChanged =
            newCategoryId !== undefined &&
            newCategoryId !== currentProduct.categoryId;
        const brandChanged =
            dto.brandId !== undefined &&
            (dto.brandId ?? null) !== currentProduct.brandId;
        await this.assertCategoryAndBrand(
            categoryChanged ? newCategoryId : undefined,
            brandChanged ? dto.brandId : undefined,
        );

        const slugChanged = !!dto.slug && dto.slug !== currentProduct.slug;
        if (slugChanged) await this.assertSlugFree(dto.slug!, id);
        const finalSlug = slugChanged ? dto.slug! : currentProduct.slug;

        const skuSource =
            (translations && this.pickTitle(translations)) || finalSlug;
        const variantPlan = await this.planVariantSync(
            currentProduct,
            dto,
            skuSource,
        );

        await this.assertMedia({
            gallery: dto.mediaIds,
            audioId: dto.audioMediaId,
            variantMedia: variantPlan?.rows.map(
                (row) => row.variantInput.mediaIds,
            ),
            variantAudio: variantPlan?.rows.map(
                (row) => row.variantInput.audioMediaId,
            ),
            optionImages: variantPlan?.rows.flatMap((row) =>
                row.optionLinks
                    .map((link) => link.imageId)
                    .filter((imageId): imageId is bigint => imageId !== null),
            ),
        });

        const status = dto.status ?? currentProduct.status;
        const statusChanged = status !== currentProduct.status;
        const gallery = dto.mediaIds?.map(BigInt);

        await this.prisma
            .$transaction(async (tx) => {
                // The variant plan was computed from `currentProduct`; if anything
                // changed since (another admin, a variant edit), refuse instead of
                // applying a plan built on stale data.
                await this.lockProductTx(tx, id, currentProduct.updatedAt);

                await tx.product.update({
                    where: { id },
                    data: {
                        slug: slugChanged ? dto.slug : undefined,
                        categoryId: newCategoryId,
                        brandId:
                            dto.brandId !== undefined
                                ? (dto.brandId ?? null)
                                : undefined,
                        thumbnailId: gallery ? (gallery[0] ?? null) : undefined,
                        audioMediaId:
                            dto.audioMediaId !== undefined
                                ? (dto.audioMediaId ?? null)
                                : undefined,
                        status: statusChanged ? status : undefined,
                        publishedAt:
                            status === ProductStatus.PUBLISHED &&
                            !currentProduct.publishedAt
                                ? new Date()
                                : undefined,
                        dietType: dto.dietType,
                        hsnCode: dto.hsnCode,
                        gstRate: dto.gstRate ?? undefined,
                        countryOfOrigin: dto.countryOfOrigin,
                        shelfLifeDays: dto.shelfLifeDays,
                        isPerishable: dto.isPerishable ?? undefined,
                        manufacturerName: dto.manufacturerName,
                        nutrition: this.json(dto.nutrition),
                    },
                });

                // Store listings mirror the product's category.
                if (categoryChanged) {
                    await tx.storeProduct.updateMany({
                        where: { productId: id },
                        data: { categoryId: newCategoryId },
                    });
                }

                if (translations) {
                    for (const translation of translations) {
                        const data = this.translationData(translation);
                        await tx.productTranslation.upsert({
                            where: {
                                productId_lang: {
                                    productId: id,
                                    lang: translation.lang,
                                },
                            },
                            update: data,
                            create: {
                                productId: id,
                                lang: translation.lang,
                                ...data,
                                searchText: "",
                            },
                        });
                    }
                }

                // Product-level gallery (variant media is handled per variant).
                if (gallery) {
                    await tx.productMedia.deleteMany({
                        where: { productId: id, variantId: null },
                    });
                    await tx.productMedia.createMany({
                        data: gallery.map((mediaId, position) => ({
                            productId: id,
                            mediaId,
                            position,
                        })),
                    });
                }

                if (variantPlan) {
                    await this.applyVariantSyncTx(
                        tx,
                        id,
                        variantPlan,
                        currentProduct.variants,
                    );
                }

                await this.rebuildSearchTextTx(tx, id);
                if (status === ProductStatus.PUBLISHED) {
                    await this.assertPublishableTx(tx, id);
                }
            }, LONG_TRANSACTION)
            .catch((error) => this.rethrow(error));

        if (statusChanged) {
            await this.cache.bustAll();
        } else {
            await this.cache.bust();
            await this.cache.bustProduct(id);
        }
        return this.adminGet(id);
    }

    /**
     * Single entry point for status changes (DRAFT / PUBLISHED / ARCHIVED),
     * used by `PATCH :id/status` and the bulk status action.
     *
     *  - Runs under a row lock, so two concurrent publishes / archives cannot
     *    interleave, and honours `expectedUpdatedAt` (409 when stale).
     *  - Idempotent: asking for the current status changes nothing and
     *    returns `changed: false` (safe to retry).
     *  - PUBLISHED enforces every publish rule; the 400 lists all problems.
     *  - `publishedAt` is set the first time a product is published.
     */
    async updateStatus(
        id: bigint,
        dto: UpdateProductStatusInput,
        bustCache = true,
    ) {
        const result = await this.prisma
            .$transaction(async (tx) => {
                const current = await this.lockProductTx(
                    tx,
                    id,
                    dto.expectedUpdatedAt,
                );
                if (current.status === dto.status) {
                    return {
                        changed: false,
                        previousStatus: current.status,
                        publishedAt: current.publishedAt,
                        updatedAt: current.updatedAt,
                    };
                }

                if (dto.status === ProductStatus.PUBLISHED) {
                    await this.assertPublishableTx(tx, id);
                }
                const updated = await tx.product.update({
                    where: { id },
                    data: {
                        status: dto.status,
                        ...(dto.status === ProductStatus.PUBLISHED &&
                        !current.publishedAt
                            ? { publishedAt: new Date() }
                            : {}),
                    },
                    select: { publishedAt: true, updatedAt: true },
                });
                return {
                    changed: true,
                    previousStatus: current.status,
                    ...updated,
                };
            })
            .catch((error) => this.rethrow(error));

        if (result.changed && bustCache) await this.cache.bustAll();
        return {
            success: true,
            id: id.toString(),
            status: dto.status,
            ...result,
        };
    }

    // ============ listing: quick edit + bulk ============

    /** Inline edit from the list: title, status, category, brand, variant price / active. */
    async quickEdit(id: bigint, dto: QuickEditProductInput) {
        await this.quickEditCore(id, dto);
        await this.cache.bustAll();
        return this.adminGet(id);
    }

    private async quickEditCore(id: bigint, dto: QuickEditProductInput) {
        const product = await this.prisma.product.findFirst({
            where: { id, deletedAt: null },
            select: {
                categoryId: true,
                brandId: true,
                status: true,
                publishedAt: true,
                updatedAt: true,
                variants: { where: { deletedAt: null }, select: { id: true } },
            },
        });
        if (!product) this.notFound();

        if (dto.categoryId === null && product.categoryId) {
            throw new BadRequestException(this.t("catalog.category.required"));
        }
        const categoryChanged =
            dto.categoryId != null && dto.categoryId !== product.categoryId;
        const brandChanged =
            dto.brandId !== undefined &&
            (dto.brandId ?? null) !== product.brandId;
        await this.assertCategoryAndBrand(
            categoryChanged ? dto.categoryId : undefined,
            brandChanged ? dto.brandId : undefined,
        );

        const liveVariantIds = new Set(
            product.variants.map((variant) => variant.id.toString()),
        );
        for (const variant of dto.variants ?? []) {
            if (!liveVariantIds.has(String(variant.id))) {
                throw new NotFoundException(this.t("catalog.variant.notFound"));
            }
        }

        const status = dto.status ?? product.status;
        const title = dto.title?.trim();

        await this.prisma
            .$transaction(async (tx) => {
                await this.lockProductTx(
                    tx,
                    id,
                    dto.expectedUpdatedAt ?? product.updatedAt,
                );
                await tx.product.update({
                    where: { id },
                    data: {
                        categoryId: categoryChanged
                            ? dto.categoryId
                            : undefined,
                        brandId: brandChanged
                            ? (dto.brandId ?? null)
                            : undefined,
                        status: dto.status,
                        publishedAt:
                            status === ProductStatus.PUBLISHED &&
                            !product.publishedAt
                                ? new Date()
                                : undefined,
                    },
                });
                if (categoryChanged) {
                    await tx.storeProduct.updateMany({
                        where: { productId: id },
                        data: { categoryId: dto.categoryId },
                    });
                }
                if (title !== undefined) {
                    const lang = this.locale.defaultLanguage;
                    await tx.productTranslation.upsert({
                        where: { productId_lang: { productId: id, lang } },
                        update: { title },
                        create: { productId: id, lang, title, searchText: "" },
                    });
                }
                for (const variant of dto.variants ?? []) {
                    await this.applyVariantUpdateTx(
                        tx,
                        id,
                        BigInt(variant.id),
                        {
                            mrp: variant.mrp,
                            isActive: variant.isActive,
                        },
                    );
                }
                if (title !== undefined || brandChanged) {
                    await this.rebuildSearchTextTx(tx, id);
                }
                if (status === ProductStatus.PUBLISHED) {
                    await this.assertPublishableTx(tx, id);
                }
            })
            .catch((error) => this.rethrow(error));
    }

    /** Runs `action` per id; one failing product never stops the others. */
    private async runBulk(
        ids: bigint[],
        action: (id: bigint) => Promise<unknown>,
    ): Promise<BulkResult> {
        const result: BulkResult = { succeeded: [], failed: [] };
        for (const id of [...new Set(ids.map(String))].map(BigInt)) {
            try {
                await action(id);
                result.succeeded.push(id.toString());
            } catch (error) {
                result.failed.push({
                    id: id.toString(),
                    message: this.errorMessage(error),
                });
            }
        }
        return result;
    }

    async bulkStatus(dto: BulkProductStatusInput) {
        const result = await this.runBulk(dto.ids, (id) =>
            this.updateStatus(id, { status: dto.status }, false),
        );
        await this.cache.bustAll();
        return result;
    }

    async bulkDelete(dto: BulkProductIdsInput) {
        const result = await this.runBulk(dto.ids, (id) =>
            this.deleteProduct(id, false),
        );
        await this.cache.bustAll();
        return result;
    }

    async bulkRestore(dto: BulkProductIdsInput) {
        const result = await this.runBulk(dto.ids, (id) =>
            this.restoreProduct(id, false),
        );
        await this.cache.bustAll();
        return result;
    }

    async bulkPurge(dto: BulkProductIdsInput) {
        const result = await this.runBulk(dto.ids, (id) =>
            this.purgeProduct(id, false),
        );
        await this.cache.bustAll();
        return result;
    }

    /** Assigns a category and / or brand to many products. */
    async bulkAssign(dto: BulkAssignProductsInput) {
        if (dto.categoryId === undefined && dto.brandId === undefined) {
            throw new BadRequestException(
                this.t("catalog.product.bulkNothingToUpdate"),
            );
        }
        // Validate once up front so a bad category / brand fails the whole request.
        await this.assertCategoryAndBrand(dto.categoryId, dto.brandId);
        const result = await this.runBulk(dto.ids, (id) =>
            this.quickEditCore(id, {
                categoryId: dto.categoryId,
                brandId: dto.brandId,
            }),
        );
        await this.cache.bustAll();
        return result;
    }

    // ============ variant operations ============

    /**
     * Adds a variant to an existing variable product. A missing SKU is
     * generated. Fails when the variant limit is reached, or the SKU /
     * combination / a barcode already exists.
     */
    async addVariant(productId: bigint, dto: VariantInput) {
        const product = await this.prisma.product.findFirst({
            where: { id: productId, deletedAt: null },
            include: { options: { orderBy: { position: "asc" } } },
        });
        if (!product) this.notFound();
        if (!product.options.length) {
            throw new BadRequestException(
                this.t("catalog.product.notVariable"),
            );
        }

        const existingVariants = await this.prisma.productVariant.findMany({
            where: { productId, deletedAt: null },
            select: { optionHash: true },
        });
        if (existingVariants.length >= MAX_VARIANTS) {
            throw new BadRequestException(
                this.t("catalog.variant.limit", { max: MAX_VARIANTS }),
            );
        }

        const [newRow] = await this.buildVariantRows(
            product.options.map((option) => option.optionGroupId),
            [{ ...dto }],
        );
        if (
            existingVariants.some(
                (existing) => existing.optionHash === newRow.optionHash,
            )
        ) {
            throw new ConflictException(
                this.t("catalog.variant.combinationExists"),
            );
        }

        await this.assertMedia({
            variantMedia: [dto.mediaIds],
            variantAudio: [dto.audioMediaId],
            optionImages: (dto.optionImages ?? []).map((item) => item.mediaId),
        });
        await this.assertBarcodesFree(this.assertVariantBarcodes([dto]));
        await this.assignMissingSkus([newRow], product.slug);
        await this.assertSkusFree([newRow.variantInput.sku!]);

        const createdVariant = await this.prisma
            .$transaction(async (tx) => {
                // Serializes concurrent adds, so the limit / combination checks hold.
                await this.lockProductTx(tx, productId);
                const liveCount = await tx.productVariant.count({
                    where: { productId, deletedAt: null },
                });
                if (liveCount >= MAX_VARIANTS) {
                    throw new BadRequestException(
                        this.t("catalog.variant.limit", { max: MAX_VARIANTS }),
                    );
                }
                const variant = await this.createVariantTx(
                    tx,
                    productId,
                    newRow,
                    liveCount,
                );
                await this.touchProductTx(tx, productId);
                await this.rebuildSearchTextTx(tx, productId);
                await this.assertStillPublishableTx(tx, productId);
                return variant;
            })
            .catch((error) =>
                this.rethrow(error, "catalog.variant.combinationExists"),
            );

        await this.cache.bustProduct(productId);
        return createdVariant;
    }

    /**
     * Updates a variant's scalar fields, and optionally replaces its barcodes
     * and media. SKU and option values are changed through `updateProduct`.
     * A published product must still satisfy the publish rules afterwards.
     */
    async updateVariant(variantId: bigint, dto: UpdateVariantInput) {
        const currentVariant = await this.prisma.productVariant.findFirst({
            where: {
                id: variantId,
                deletedAt: null,
                product: { deletedAt: null },
            },
        });
        if (!currentVariant) {
            throw new NotFoundException(this.t("catalog.variant.notFound"));
        }

        await this.assertMedia({
            variantMedia: [dto.mediaIds],
            variantAudio: [dto.audioMediaId],
        });
        if (dto.barcodes) {
            await this.assertBarcodesFree(this.assertVariantBarcodes([dto]), [
                variantId,
            ]);
        }

        await this.prisma
            .$transaction(async (tx) => {
                await this.lockProductTx(tx, currentVariant.productId);
                await this.applyVariantUpdateTx(
                    tx,
                    currentVariant.productId,
                    variantId,
                    dto,
                );
                await this.touchProductTx(tx, currentVariant.productId);
                await this.assertStillPublishableTx(
                    tx,
                    currentVariant.productId,
                );
            })
            .catch((error) => this.rethrow(error));

        await this.cache.bustProduct(currentVariant.productId);
        return { success: true };
    }

    /**
     * Soft-deletes a variant. A published product must keep satisfying the
     * publish rules (e.g. one active variant); a draft may lose its last one.
     */
    async deleteVariant(variantId: bigint) {
        const variant = await this.prisma.productVariant.findFirst({
            where: {
                id: variantId,
                deletedAt: null,
                product: { deletedAt: null },
            },
        });
        if (!variant) {
            throw new NotFoundException(this.t("catalog.variant.notFound"));
        }

        await this.prisma
            .$transaction(async (tx) => {
                await this.lockProductTx(tx, variant.productId);
                // Another request may have deleted it while we waited for the lock.
                const stillLive = await tx.productVariant.count({
                    where: { id: variantId, deletedAt: null },
                });
                if (!stillLive) {
                    throw new NotFoundException(
                        this.t("catalog.variant.notFound"),
                    );
                }
                await this.softDeleteVariantTx(tx, variantId);
                await this.touchProductTx(tx, variant.productId);
                await this.rebuildSearchTextTx(tx, variant.productId);
                await this.assertStillPublishableTx(tx, variant.productId);
            })
            .catch((error) => this.rethrow(error));

        await this.cache.bustProduct(variant.productId);
        return { success: true };
    }

    /** Writes the scalar fields (and optional barcodes / media) of one variant. */
    private async applyVariantUpdateTx(
        tx: Db,
        productId: bigint,
        variantId: bigint,
        dto: UpdateVariantInput,
    ) {
        const barcodeRows = dto.barcodes
            ? this.barcodeRows(dto.barcodes)
            : null;

        await tx.productVariant.update({
            where: { id: variantId },
            data: {
                mrp: dto.mrp,
                unit: dto.unit,
                unitValue: dto.unitValue,
                weightGrams: dto.weightGrams,
                isActive: dto.isActive,
                position: dto.position,
                audioMediaId:
                    dto.audioMediaId !== undefined
                        ? (dto.audioMediaId ?? null)
                        : undefined,
            },
        });

        // Admin lowered the MRP: store prices above it are discarded (reset to the new MRP, flagged MRP_RESET).
        if (dto.mrp != null) {
            await this.stock.applyCatalogMrpTx(tx, variantId, Number(dto.mrp));
        }

        // A deactivated variant must disappear from every store listing too.
        if (dto.isActive === false) {
            await tx.storeProduct.updateMany({
                where: { variantId },
                data: { isActive: false },
            });
        }

        if (barcodeRows) {
            await tx.productBarcode.deleteMany({ where: { variantId } });
            await tx.productBarcode.createMany({
                data: barcodeRows.map((barcode) => ({ ...barcode, variantId })),
            });
        }

        if (dto.mediaIds) {
            await tx.productMedia.deleteMany({ where: { variantId } });
            await tx.productMedia.createMany({
                data: dto.mediaIds.map((mediaId, position) => ({
                    productId,
                    variantId,
                    mediaId,
                    position,
                })),
            });
        }
    }

    /**
     * Soft-deletes one variant: suffixes SKU and option hash with `-del-{id}`
     * (so they can be reused), deactivates it and all of its store listings.
     */
    private async softDeleteVariantTx(tx: Db, variantId: bigint) {
        const variant = await tx.productVariant.findUniqueOrThrow({
            where: { id: variantId },
        });

        await tx.productVariant.update({
            where: { id: variantId },
            data: {
                deletedAt: new Date(),
                isActive: false,
                sku: `${variant.sku.slice(0, Math.max(1, 64 - `-del-${variant.id}`.length))}-del-${variant.id}`,
                optionHash: `${variant.optionHash.slice(0, Math.max(1, 100 - `-del-${variant.id}`.length))}-del-${variant.id}`,
            },
        });
        await tx.storeProduct.updateMany({
            where: { variantId },
            data: { isActive: false },
        });
    }

    // ============ DELETE / RESTORE ============

    /**
     * Soft-deletes a product, atomically: marks it deleted and `ARCHIVED`,
     * frees its slug and all variant SKUs / option hashes (suffix
     * `-del-{id}`), soft-deletes its variants and deactivates all of its
     * store listings. Everything needed to undo this is kept in the
     * `deletedPrevious*` columns (see {@link restoreProduct}).
     */
    async deleteProduct(id: bigint, bustCache = true) {
        const product = await this.prisma.product.findFirst({
            where: { id, deletedAt: null },
            include: {
                variants: { where: { deletedAt: null } },
                storeProducts: { select: { id: true, isActive: true } },
            },
        });
        if (!product) this.notFound();

        const deletedAt = new Date();
        await this.prisma.$transaction(async (tx) => {
            await tx.product.update({
                where: { id },
                data: {
                    deletedAt,
                    deletedPreviousStatus: product.status,
                    deletedPreviousSlug: product.slug,
                    status: ProductStatus.ARCHIVED,
                    slug: `${product.slug.slice(0, Math.max(1, 191 - `-del-${id}`.length))}-del-${id}`,
                },
            });
            for (const variant of product.variants) {
                await tx.productVariant.update({
                    where: { id: variant.id },
                    data: {
                        deletedAt,
                        deletedWithProduct: true,
                        deletedPreviousSku: variant.sku,
                        deletedPreviousOptionHash: variant.optionHash,
                        deletedPreviousIsActive: variant.isActive,
                        isActive: false,
                        sku: `${variant.sku.slice(0, Math.max(1, 64 - `-del-${variant.id}`.length))}-del-${variant.id}`,
                        optionHash: `${variant.optionHash.slice(0, Math.max(1, 100 - `-del-${variant.id}`.length))}-del-${variant.id}`,
                    },
                });
            }
            for (const listing of product.storeProducts) {
                await tx.storeProduct.update({
                    where: { id: listing.id },
                    data: {
                        deletedPreviousIsActive: listing.isActive,
                        isActive: false,
                    },
                });
            }
        });

        if (bustCache) {
            await this.cache.bust();
            await this.cache.bustProduct(id);
        }
        return { success: true };
    }

    /**
     * Restores a product from the trash: original status, slug, SKUs, option
     * hashes, variant activity and per-store listing activity. Category /
     * brand activity is NOT re-checked; use `PATCH :id/status` to republish.
     *
     * @throws ConflictException if the original slug / SKU / option hash was taken meanwhile.
     */
    async restoreProduct(id: bigint, bustCache = true) {
        const trashedProduct = await this.prisma.product.findFirst({
            where: { id, deletedAt: { not: null } },
            include: {
                variants: { where: { deletedWithProduct: true } },
                storeProducts: {
                    where: { deletedPreviousIsActive: { not: null } },
                },
            },
        });
        if (!trashedProduct) {
            throw new NotFoundException(
                this.t("catalog.product.trashNotFound"),
            );
        }

        // A draft may legitimately have been deleted without variants.
        const metadataMissing =
            !trashedProduct.deletedPreviousSlug ||
            trashedProduct.variants.some(
                (variant) =>
                    !variant.deletedPreviousSku ||
                    !variant.deletedPreviousOptionHash,
            );
        if (metadataMissing) {
            throw new ConflictException(
                this.t("catalog.product.restoreMetadataMissing"),
            );
        }

        const originalSlug = trashedProduct.deletedPreviousSlug!;
        const variantsToRestore = trashedProduct.variants.map((variant) => ({
            ...variant,
            sku: variant.deletedPreviousSku!,
            optionHash: variant.deletedPreviousOptionHash!,
        }));

        const slugConflict = await this.prisma.product.findFirst({
            where: { id: { not: id }, slug: originalSlug },
            select: { id: true },
        });
        if (slugConflict) {
            throw new ConflictException(
                this.t("catalog.product.restoreSlugConflict"),
            );
        }

        const restoringVariantIds = variantsToRestore.map(
            (variant) => variant.id,
        );
        if (variantsToRestore.length) {
            const [skuConflict, optionHashConflict] = await Promise.all([
                this.prisma.productVariant.findFirst({
                    where: {
                        id: { notIn: restoringVariantIds },
                        sku: {
                            in: variantsToRestore.map((variant) => variant.sku),
                        },
                    },
                    select: { id: true },
                }),
                this.prisma.productVariant.findFirst({
                    where: {
                        productId: id,
                        id: { notIn: restoringVariantIds },
                        optionHash: {
                            in: variantsToRestore.map(
                                (variant) => variant.optionHash,
                            ),
                        },
                    },
                    select: { id: true },
                }),
            ]);
            if (skuConflict || optionHashConflict) {
                throw new ConflictException(
                    this.t("catalog.product.restoreVariantConflict"),
                );
            }
        }

        await this.prisma.$transaction(async (tx) => {
            await tx.product.update({
                where: { id },
                data: {
                    slug: originalSlug,
                    status:
                        trashedProduct.deletedPreviousStatus ??
                        (trashedProduct.publishedAt
                            ? ProductStatus.PUBLISHED
                            : ProductStatus.DRAFT),
                    deletedAt: null,
                    deletedPreviousStatus: null,
                    deletedPreviousSlug: null,
                },
            });
            for (const variant of variantsToRestore) {
                await tx.productVariant.update({
                    where: { id: variant.id },
                    data: {
                        sku: variant.sku,
                        optionHash: variant.optionHash,
                        isActive: variant.deletedPreviousIsActive ?? true,
                        deletedAt: null,
                        deletedWithProduct: false,
                        deletedPreviousSku: null,
                        deletedPreviousOptionHash: null,
                        deletedPreviousIsActive: null,
                    },
                });
            }
            for (const listing of trashedProduct.storeProducts) {
                await tx.storeProduct.update({
                    where: { id: listing.id },
                    data: {
                        isActive: listing.deletedPreviousIsActive ?? false,
                        deletedPreviousIsActive: null,
                    },
                });
            }
        });

        if (bustCache) await this.cache.bustAll();
        return { success: true, id: id.toString(), restored: true };
    }

    /**
     * Permanently deletes a product that is already in the trash. Any other
     * foreign key still pointing at it (e.g. past orders) surfaces as P2003
     * and is mapped to 409, so history is never silently destroyed.
     */
    async purgeProduct(id: bigint, bustCache = true) {
        const trashedProduct = await this.prisma.product.findFirst({
            where: { id, deletedAt: { not: null } },
            select: { id: true },
        });
        if (!trashedProduct) {
            throw new NotFoundException(
                this.t("catalog.product.trashNotFound"),
            );
        }

        await this.prisma
            .$transaction(async (tx) => {
                const variants = await tx.productVariant.findMany({
                    where: { productId: id },
                    select: { id: true },
                });
                const variantIds = variants.map((variant) => variant.id);

                await tx.productMedia.deleteMany({ where: { productId: id } });
                await tx.productBarcode.deleteMany({
                    where: { variantId: { in: variantIds } },
                });
                await tx.variantOptionValue.deleteMany({
                    where: { variantId: { in: variantIds } },
                });
                await tx.storeProduct.deleteMany({ where: { productId: id } });
                await tx.productVariant.deleteMany({
                    where: { productId: id },
                });
                await tx.productOption.deleteMany({ where: { productId: id } });
                await tx.productTranslation.deleteMany({
                    where: { productId: id },
                });
                await tx.product.delete({ where: { id } });
            }, LONG_TRANSACTION)
            .catch((error) => {
                if ((error as { code?: string })?.code === "P2003") {
                    throw new ConflictException(
                        this.t("catalog.product.inUse"),
                    );
                }
                throw error;
            });

        if (bustCache) await this.cache.bustAll();
        return { success: true, id: id.toString() };
    }

    // ============ storefront (public, cached) ============

    /**
     * Store-scoped product listing with search, category/brand filters and
     * sorting. Pagination is DB-side with `groupBy(productId)` (`take + 1`
     * for `hasMore`); every sort has a `productId` tiebreaker.
     */
    async storefrontList(query: ListProductsInput, lang: string) {
        if (!query.storeId) {
            throw new BadRequestException(this.t("catalog.store.idRequired"));
        }

        const { take, skip, page } = pageParams(query, 50);

        // 1. text search -> candidate products
        let searchFilter: Prisma.StoreProductWhereInput = {};
        if (query.q) {
            const matchingTranslations =
                await this.prisma.productTranslation.findMany({
                    where: {
                        AND: this.tokenize(query.q).map((token) => ({
                            searchText: {
                                contains: token,
                                mode: "insensitive" as const,
                            },
                        })),
                    },
                    select: { productId: true },
                    distinct: ["productId"],
                    take: 500,
                });
            if (!matchingTranslations.length) {
                return { items: [], page, hasMore: false };
            }
            searchFilter = {
                productId: {
                    in: matchingTranslations.map((hit) => hit.productId),
                },
            };
        }

        // 2. category / category-group filter includes the whole subtree
        let categoryFilter: Prisma.StoreProductWhereInput = {};
        const categoryIds = await this.categoryFilter(query);
        if (categoryIds) categoryFilter = { categoryId: { in: categoryIds } };
        const brandIds = this.brandFilter(query);

        const where: Prisma.StoreProductWhereInput = {
            storeId: query.storeId,
            isActive: true,
            ...searchFilter,
            ...categoryFilter,
            variant: { isActive: true, deletedAt: null },
            product: {
                status: ProductStatus.PUBLISHED,
                deletedAt: null,
                ...(brandIds ? { brandId: { in: brandIds } } : {}),
            },
        };

        const orderBy: any[] =
            query.sort === "price_asc"
                ? [{ _min: { sellingPrice: "asc" } }, { productId: "desc" }]
                : query.sort === "price_desc"
                  ? [{ _min: { sellingPrice: "desc" } }, { productId: "desc" }]
                  : [{ productId: "desc" }];

        // 3. one row per product, `take + 1` to detect another page
        const productGroups: { productId: bigint }[] = await (
            this.prisma.storeProduct as any
        ).groupBy({
            by: ["productId"],
            where,
            orderBy,
            skip,
            take: take + 1,
        });
        const hasMore = productGroups.length > take;
        const pageProductIds = productGroups
            .slice(0, take)
            .map((group) => group.productId);
        if (!pageProductIds.length) return { items: [], page, hasMore: false };

        // 4. load the listings of this page and assemble product cards
        const languages = [...new Set([lang, this.locale.defaultLanguage])];
        const storeListings = await this.prisma.storeProduct.findMany({
            where: { ...where, productId: { in: pageProductIds } },
            include: {
                variant: {
                    include: {
                        optionValues: {
                            include: {
                                optionValue: { select: { label: true } },
                            },
                        },
                    },
                },
                product: {
                    include: {
                        translations: { where: { lang: { in: languages } } },
                        thumbnail: {
                            select: {
                                key: true,
                                variants: true,
                                isPrivate: true,
                            },
                        },
                        brand: { select: { name: true } },
                    },
                },
            },
        });

        const cardByProductId = new Map<string, any>();
        for (const listing of storeListings) {
            const productKey = listing.productId.toString();
            const translation =
                listing.product.translations.find(
                    (item) => item.lang === lang,
                ) ??
                listing.product.translations.find(
                    (item) => item.lang === this.locale.defaultLanguage,
                );
            const mrp = num(listing.currentMrp ?? listing.variant.mrp);

            const productCard = cardByProductId.get(productKey) ?? {
                productId: listing.productId,
                currency: this.currency.info,
                slug: listing.product.slug,
                title: translation?.title ?? "",
                shortDescription: translation?.shortDescription,
                thumbnailUrl: listing.product.thumbnail
                    ? this.media.urlForVariant(
                          listing.product.thumbnail,
                          "thumb",
                      )
                    : null,
                brand: listing.product.brand
                    ? this.locale.pick(listing.product.brand.name, lang)
                    : null,
                dietType: listing.product.dietType,
                variants: [],
            };

            const sellable = listing.availableQty - listing.reservedQty;
            const flash = flashState(listing);
            productCard.variants.push({
                variantId: listing.variantId,
                sku: listing.variant.sku,
                availability: sellable >= listing.minOrderQty ? "AVAILABLE" : "OUT_OF_STOCK",
                flashSale: flash.live
                    ? { endsAt: flash.endsAt, remaining: flash.remaining, maxPerOrder: flash.maxPerOrder, regularPrice: this.currency.format(flash.regularPrice) }
                    : null,
                label:
                    listing.variant.optionValues
                        .map((link) =>
                            this.locale.pick(link.optionValue.label, lang),
                        )
                        .join(" / ") || null,
                price: this.currency.format(Math.min(flash.price, mrp)),
                mrp: this.currency.format(mrp),
                discountPct:
                    mrp > 0
                        ? Math.round(
                              (1 - Math.min(flash.price, mrp) / mrp) * 100,
                          )
                        : 0,
                inStock: sellable >= listing.minOrderQty,
                unit: listing.variant.unit,
                unitValue: listing.variant.unitValue,
            });
            cardByProductId.set(productKey, productCard);
        }

        const items = pageProductIds
            .map((productId) => cardByProductId.get(productId.toString()))
            .filter(Boolean)
            .map((card) => ({
                ...card,
                // Listed + live but nothing sellable -> the card shows "Out of stock".
                availability: card.variants.some((v: { availability: string }) => v.availability === "AVAILABLE")
                    ? "AVAILABLE"
                    : "OUT_OF_STOCK",
            }));
        return { items, page, hasMore };
    }

    /**
     * Storefront product detail by slug. The store-independent body is
     * cached under `prod:{id}:{lang}`; with `storeId`, variants are narrowed
     * to those listed in that store and enriched with price, stock and
     * min / max quantities.
     */
    async storefrontDetail(
        slug: string,
        storeId: bigint | undefined,
        lang: string,
    ) {
        const publishedProduct = await this.prisma.product.findFirst({
            where: { slug, status: ProductStatus.PUBLISHED, deletedAt: null },
            select: { id: true },
        });
        if (!publishedProduct) this.notFound();

        const languages = [...new Set([lang, this.locale.defaultLanguage])];
        const body = await this.cache.product(
            CatalogCacheService.keys.product(publishedProduct.id, lang),
            async () => {
                const product = await this.prisma.product.findUniqueOrThrow({
                    where: { id: publishedProduct.id },
                    include: {
                        translations: { where: { lang: { in: languages } } },
                        brand: true,
                        category: true,
                        audioMedia: { select: { key: true } },
                        options: {
                            include: { optionGroup: true },
                            orderBy: { position: "asc" },
                        },
                        media: {
                            where: { variantId: null },
                            include: { media: true },
                            orderBy: { position: "asc" },
                        },
                        variants: {
                            where: { isActive: true, deletedAt: null },
                            orderBy: { position: "asc" },
                            include: {
                                optionValues: {
                                    include: {
                                        optionValue: true,
                                        image: { select: { key: true } },
                                    },
                                },
                                media: {
                                    include: { media: true },
                                    orderBy: { position: "asc" },
                                },
                                barcodes: { where: { isPrimary: true } },
                                audioMedia: { select: { key: true } },
                            },
                        },
                    },
                });

                // Requested language first, default language as fallback.
                const translation =
                    product.translations.find((item) => item.lang === lang) ??
                    product.translations.find(
                        (item) => item.lang === this.locale.defaultLanguage,
                    );

                return {
                    id: product.id,
                    slug: product.slug,
                    isVariable: product.options.length > 0,
                    title: translation?.title,
                    shortDescription: translation?.shortDescription,
                    description: translation?.description,
                    keyFeatures: translation?.keyFeatures ?? [],
                    ingredients: translation?.ingredients,
                    storageInstructions: translation?.storageInstructions,
                    allergens: translation?.allergens ?? [],
                    attributes: translation?.attributes ?? [],
                    seo: {
                        title: translation?.seoTitle || translation?.title,
                        description:
                            translation?.seoDescription ||
                            translation?.shortDescription,
                    },
                    brand: product.brand
                        ? {
                              id: product.brand.id,
                              name: this.locale.pick(product.brand.name, lang),
                          }
                        : null,
                    category: product.category
                        ? {
                              id: product.category.id,
                              name: this.locale.pick(
                                  product.category.name,
                                  lang,
                              ),
                              slug: product.category.slug,
                          }
                        : null,
                    dietType: product.dietType,
                    countryOfOrigin: product.countryOfOrigin,
                    nutrition:
                        product.nutrition || translation?.nutrition
                            ? {
                                  meta: product.nutrition,
                                  table: translation?.nutrition ?? null,
                              }
                            : null,
                    manufacturerName: product.manufacturerName,
                    manufacturerAddress: translation?.manufacturerAddress,
                    shelfLifeDays: product.shelfLifeDays,
                    audioUrl: product.audioMedia
                        ? this.media.urlForKey(product.audioMedia.key)
                        : null,
                    options: product.options.map((option) => ({
                        id: option.optionGroupId,
                        code: option.optionGroup.code,
                        name: this.locale.pick(option.optionGroup.name, lang),
                    })),
                    images: product.media.map((item) => ({
                        id: item.mediaId,
                        url: this.media.urlForKey(item.media.key),
                    })),
                    variants: product.variants.map((variant) => ({
                        id: variant.id,
                        sku: variant.sku,
                        mrp: num(variant.mrp),
                        unit: variant.unit,
                        unitValue: variant.unitValue,
                        weightGrams: variant.weightGrams,
                        barcode: variant.barcodes[0]?.code ?? null,
                        optionValueIds: variant.optionValues.map(
                            (link) => link.optionValueId,
                        ),
                        optionImages: variant.optionValues
                            .filter((link) => link.image)
                            .map((link) => ({
                                optionValueId: link.optionValueId,
                                url: this.media.urlForKey(link.image!.key),
                            })),
                        label:
                            variant.optionValues
                                .map((link) =>
                                    this.locale.pick(
                                        link.optionValue.label,
                                        lang,
                                    ),
                                )
                                .join(" / ") || null,
                        images: variant.media.map((item) => ({
                            id: item.mediaId,
                            url: this.media.urlForKey(item.media.key),
                        })),
                        // Variant audio, falling back to the product's.
                        audioUrl: variant.audioMedia
                            ? this.media.urlForKey(variant.audioMedia.key)
                            : product.audioMedia
                              ? this.media.urlForKey(product.audioMedia.key)
                              : null,
                    })),
                };
            },
        );

        // Prices are formatted after caching so a currency change never needs a cache flush.
        const withFormattedMrp = (variant: any) => ({
            ...variant,
            mrp: this.currency.format(variant.mrp),
        });

        if (!storeId) {
            return {
                ...body,
                currency: this.currency.info,
                variants: body.variants.map(withFormattedMrp),
            };
        }

        // Every listing of this product in the store, whatever its status: a
        // customer may land here from a search engine for a product the store
        // doesn't sell (yet) — the page then says NOT_AVAILABLE instead of 404.
        const storeListings = await this.prisma.storeProduct.findMany({
            where: { storeId, productId: publishedProduct.id },
        });
        const listingByVariantId = new Map(
            storeListings.map((listing) => [
                listing.variantId.toString(),
                listing,
            ]),
        );
        const variants = body.variants.map((variant: any) => {
            const listing = listingByVariantId.get(String(variant.id));
            // Not listed / draft / inactive / waiting for approval → not sold here.
            if (!listing || (!listing.isActive && listing.status !== "SCHEDULED")) {
                return {
                    ...withFormattedMrp(variant),
                    availability: "NOT_AVAILABLE",
                    price: null,
                    inStock: false,
                };
            }
            if (!listing.isActive) {
                // SCHEDULED: coming soon.
                return {
                    ...withFormattedMrp(variant),
                    availability: "NOT_AVAILABLE",
                    availableFrom: listing.publishAt,
                    price: null,
                    inStock: false,
                };
            }
            const mrp = num(listing.currentMrp ?? variant.mrp);
            const flash = flashState(listing);
            const sellable = listing.availableQty - listing.reservedQty;
            const inStock = sellable >= listing.minOrderQty;
            return {
                ...variant,
                availability: inStock ? "AVAILABLE" : "OUT_OF_STOCK",
                price: this.currency.format(Math.min(flash.price, mrp)),
                mrp: this.currency.format(mrp),
                flashSale: flash.live
                    ? { endsAt: flash.endsAt, remaining: flash.remaining, maxPerOrder: flash.maxPerOrder, regularPrice: this.currency.format(flash.regularPrice) }
                    : null,
                inStock,
                maxQty: flash.maxPerOrder != null ? Math.min(listing.maxOrderQty ?? Infinity, flash.maxPerOrder) : listing.maxOrderQty,
                minQty: listing.minOrderQty,
            };
        });
        const availability = variants.some((v: any) => v.availability === "AVAILABLE")
            ? "AVAILABLE"
            : variants.some((v: any) => v.availability === "OUT_OF_STOCK")
              ? "OUT_OF_STOCK"
              : "NOT_AVAILABLE";
        return {
            ...body,
            currency: this.currency.info,
            /** AVAILABLE | OUT_OF_STOCK (listed, no stock) | NOT_AVAILABLE (not sold in this store) */
            availability,
            variants,
        };
    }
}
