import {
    normalizeSearch,
    pageParams,
    randomToken,
    toUrlSlug,
} from "@common/utils/helpers.util";
import {
    richTextMapToPlain,
    sanitizeRichTextMap,
} from "@common/utils/richText.util";
import { PrismaService } from "@core/database/prisma.service";
import { LocaleService } from "@core/locale/locale.service";
import {
    BrandBulkStatusInput,
    BrandInput,
    BrandListInput,
    BrandSort,
    BrandStatusInput,
    CheckBrandSlugInput,
} from "./brand.types";
import { CatalogCacheService } from "../shared/catalog-cache.service";
import { CatalogMediaValidator } from "../shared/catalog-media.validator";
import { throwUniqueConflict } from "../shared/catalog.util";
import { MediaService } from "@modules/media/media.service";
import {
    BadRequestException,
    ConflictException,
    Injectable,
    NotFoundException,
} from "@nestjs/common";
import { BrandStatus, MediaPurpose, Prisma } from "@prisma-client/client";
import { I18nContext, I18nService } from "nestjs-i18n";

const SERIALIZABLE = {
    isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    timeout: 30_000,
    maxWait: 10_000,
} as const;

/** Bulk detach rewrites product search text row by row: allow more time. */
const SERIALIZABLE_BULK = { ...SERIALIZABLE, timeout: 120_000 } as const;

const IMAGE_SELECT = {
    id: true,
    key: true,
    variants: true,
    isPrivate: true,
} as const;

/** Max characters of the plain-text `shortDescription` (per language). */
export const BRAND_SHORT_DESCRIPTION_LENGTH = 160;

/** Maps the public `sort` value to a Prisma `orderBy` for brands. */
const BRAND_ORDER_BY: Record<BrandSort, Prisma.BrandOrderByWithRelationInput> =
    {
        id_desc: { id: "desc" },
        id_asc: { id: "asc" },
        slug_asc: { slug: "asc" },
        slug_desc: { slug: "desc" },
        updated_asc: { updatedAt: "asc" },
        updated_desc: { updatedAt: "desc" },
    };

const splitTokens = (values: string[]) =>
    new Set(
        values.flatMap((v) => normalizeSearch(v).split(" ")).filter(Boolean),
    );

/** Why a brand cannot change status (returned in 409 / dry-run). */
export interface BrandStatusBlocker {
    id: string;
    code: "inUse";
    /** Translated, ready to show. */
    message: string;
    productCount: number;
}

/**
 * Brand domain service (admin CRUD + public storefront reads).
 *
 * Status lifecycle (`BrandStatus`):
 *  - ACTIVE   -> visible on the storefront, usable by products.
 *  - INACTIVE -> hidden (retired). Kept for history / restore.
 *
 * Leaving ACTIVE is guarded: no product (including soft-deleted ones, which
 * can be restored) may reference the brand, unless the caller asks to
 * detach the brand from those products (`detachProducts`). Hard delete
 * follows the "no product" rule.
 *
 * Depends only on infrastructure (prisma, cache, media, locale), never on
 * `CatalogService`, so product code can depend on it without cycles.
 *
 * Cache: the storefront list is cached under `CatalogCacheService.keys.brands`.
 * Every write busts catalog AND product-detail caches (`bustAll`) because
 * the brand name is embedded in cached product bodies.
 */
@Injectable()
export class BrandService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly cache: CatalogCacheService,
        private readonly media: MediaService,
        private readonly mediaValidator: CatalogMediaValidator,
        private readonly locale: LocaleService,
        private readonly i18n: I18nService,
    ) {}

    // ============ admin ============

    /**
     * Checks whether a brand slug is available (queries the DB directly, no
     * cache). Suggests the next free `slug-N` when taken. The suggestion is
     * not reserved; the unique constraint stays authoritative.
     */
    async checkSlug(query: CheckBrandSlugInput) {
        if (!query.title?.trim() && !query.slug?.trim()) {
            throw new BadRequestException(
                this.i18n.translate("catalog.brand.slugInputRequired"),
            );
        }

        const baseSlug = toUrlSlug(
            query.slug?.trim() || query.title?.trim() || "",
        );
        if (!baseSlug) {
            throw new BadRequestException(
                this.i18n.translate("catalog.brand.slugInvalid"),
            );
        }

        const excludeId = query.excludeId ? query.excludeId : undefined;

        // Fetch only matching slugs. No cache: this must reflect current DB state.
        const rows = await this.prisma.brand.findMany({
            where: {
                ...(excludeId !== undefined ? { id: { not: excludeId } } : {}),
                slug: { startsWith: baseSlug },
            },
            select: { slug: true },
        });

        const existingSlugs = new Set(rows.map((r) => r.slug));
        if (!existingSlugs.has(baseSlug)) {
            return { exists: false, slug: baseSlug, suggestion: null };
        }

        let n = 2;
        let suggestion = `${baseSlug}-${n}`;
        while (existingSlugs.has(suggestion)) suggestion = `${baseSlug}-${++n}`;
        return { exists: true, slug: baseSlug, suggestion };
    }

    /**
     * Creates or updates a brand in ONE serializable transaction.
     *
     * - Validates localized maps and logo/banner media.
     * - `description` HTML is sanitized to the rich-text whitelist
     *   (see `rich-text.util.ts`); languages left empty are dropped.
     * - Slug: `dto.slug`, else derived from default-language name on create
     *   (random `b-xxx` fallback), untouched on update unless sent (409 if taken).
     * - `status`: defaults to ACTIVE on create; omitted on update keeps the
     *   current one. Leaving ACTIVE is refused while products use the brand
     *   (use the status endpoint with `detachProducts` for that).
     * - When the name changes, the brand-name tokens in the products'
     *   translation `searchText` are refreshed.
     * - Busts catalog AND product-detail caches.
     */
    async upsert(dto: BrandInput, id?: bigint) {
        await this.mediaValidator.assertImages([
            {
                id: dto.logoId,
                purpose: MediaPurpose.BRAND,
                profile: this.mediaValidator.profiles.BRAND!.master,
            },
            {
                id: dto.bannerId,
                purpose: MediaPurpose.BRAND_BANNER,
                profile: this.mediaValidator.profiles.BRAND_BANNER!.master,
            },
        ]);

        const name = this.locale.cleanMap(dto.name, "name")!;
        const description = sanitizeRichTextMap(
            this.locale.cleanMap(dto.description, "description", false),
        );

        const slug =
            dto.slug ??
            (id
                ? undefined
                : toUrlSlug(name[this.locale.defaultLanguage]) ||
                  `b-${randomToken(3)}`);

        let detached: (bigint | null)[] = [];
        const row = await this.prisma
            .$transaction(async (tx) => {
                let previous: {
                    status: BrandStatus;
                    name: Prisma.JsonValue;
                    logoId: bigint | null;
                    bannerId: bigint | null;
                } | null = null;

                if (id) {
                    previous = await tx.brand.findUnique({
                        where: { id },
                        select: {
                            status: true,
                            name: true,
                            logoId: true,
                            bannerId: true,
                        },
                    });
                    if (!previous) {
                        throw new NotFoundException(
                            this.i18n.translate("catalog.brand.notFound"),
                        );
                    }
                }

                const status =
                    dto.status ?? previous?.status ?? BrandStatus.ACTIVE;

                if (
                    id &&
                    previous?.status === BrandStatus.ACTIVE &&
                    status !== BrandStatus.ACTIVE
                ) {
                    await this.assertUnused(tx, id);
                }

                const data = {
                    name,
                    description: description ?? null,
                    logoId: dto.logoId,
                    bannerId: dto.bannerId ?? null,
                    status,
                };

                if (!id) {
                    return tx.brand.create({ data: { ...data, slug: slug! } });
                }

                const updated = await tx.brand.update({
                    where: { id },
                    data: { ...data, slug },
                });
                await this.reindexProductSearch(tx, id, previous!.name, name);
                detached = [previous!.logoId, previous!.bannerId].filter(
                    (m) => m != null && m !== data.logoId && m !== data.bannerId,
                );
                return updated;
            }, SERIALIZABLE)
            .catch((e) =>
                throwUniqueConflict(this.i18n, e, "catalog.brand.slugTaken"),
            );

        await this.cache.bustAll();
        // Logo / banner removed or replaced: delete the old file unless something else uses it.
        await this.media.removeDetached(detached);
        return row;
    }

    /**
     * Changes the status of ONE brand. Same rules as `bulkSetStatus`
     * (including `detachProducts`). Idempotent.
     */
    async setStatus(id: bigint, dto: BrandStatusInput) {
        const r = await this.bulkSetStatus({
            ...dto,
            ids: [id],
            dryRun: false,
        });
        return {
            success: true,
            id: id.toString(),
            status: dto.status,
            detachedProductCount: r.detachedProductCount,
        };
    }

    /**
     * Changes the status of many brands in ONE serializable transaction.
     * All-or-nothing: if any brand is blocked, nothing is saved and a 409
     * lists every blocker. Brands already in the target status are reported
     * as unchanged.
     *
     * Leaving ACTIVE:
     *  - Products (incl. soft-deleted) use it -> blocked, unless
     *    `detachProducts`: the brand is removed from those products
     *    (`brandId = null`) and its name tokens are removed from their
     *    search text, then the status changes.
     * Becoming ACTIVE: no checks.
     *
     * `dryRun`: runs every check and returns the plan + blockers without
     * writing anything (lets the admin UI show "N products will lose their brand").
     */
    async bulkSetStatus(dto: BrandBulkStatusInput) {
        const ids = [
            ...new Map(dto.ids.map((i) => [i.toString(), i])).values(),
        ];
        const status = dto.status;
        const deactivating = status !== BrandStatus.ACTIVE;
        const detach = deactivating && dto.detachProducts === true;
        const dryRun = dto.dryRun === true;

        const lang = I18nContext.current()?.lang ?? this.locale.defaultLanguage;
        const nameOf = (row: { name: Prisma.JsonValue }) =>
            (this.locale.pick(row.name, lang) as string | null) ?? "";

        const result = await this.prisma.$transaction(async (tx) => {
            const rows = await tx.brand.findMany({
                where: { id: { in: ids } },
                select: { id: true, status: true, name: true },
            });
            if (rows.length !== ids.length) {
                const found = new Set(rows.map((r) => r.id.toString()));
                const missing = ids.filter((i) => !found.has(i.toString()));
                throw new NotFoundException(
                    ids.length === 1
                        ? this.t("catalog.brand.notFound")
                        : this.t("catalog.brand.bulkNotFound", {
                              ids: missing.join(", "),
                          }),
                );
            }

            const changing = rows.filter((r) => r.status !== status);
            const unchanged = rows.filter((r) => r.status === status);
            const leaving = deactivating
                ? changing.filter((r) => r.status === BrandStatus.ACTIVE)
                : [];

            const usage = await this.productCountByBrand(
                tx,
                leaving.map((r) => r.id),
            );
            const used = leaving.filter((r) => usage.has(r.id.toString()));

            const blockers: BrandStatusBlocker[] = detach
                ? []
                : used.map((r) => {
                      const count = usage.get(r.id.toString())!;
                      return {
                          id: r.id.toString(),
                          code: "inUse" as const,
                          message: this.t("catalog.brand.blocker.inUse", {
                              name: nameOf(r),
                              products: count,
                          }),
                          productCount: count,
                      };
                  });

            let totalProducts = 0;
            for (const n of usage.values()) totalProducts += n;

            const summary = {
                dryRun,
                status,
                updatedIds: changing.map((r) => r.id.toString()),
                unchangedIds: unchanged.map((r) => r.id.toString()),
                detachedProductCount: detach ? totalProducts : 0,
                blockers,
            };

            if (dryRun) {
                return {
                    success: true,
                    canApply: blockers.length === 0,
                    ...summary,
                };
            }
            if (blockers.length) throw this.blockedError(blockers);

            // 1. Remove the brand from its products (search text first,
            //    while the products can still be found by brandId).
            if (detach && used.length) {
                for (const r of used) {
                    await this.reindexProductSearch(tx, r.id, r.name, {});
                }
                const detached = await tx.product.updateMany({
                    where: { brandId: { in: used.map((r) => r.id) } },
                    data: { brandId: null },
                });
                summary.detachedProductCount = detached.count;
            }

            // 2. Apply the status.
            if (changing.length) {
                await tx.brand.updateMany({
                    where: { id: { in: changing.map((r) => r.id) } },
                    data: { status },
                });
            }

            return { success: true, canApply: true, ...summary };
        }, SERIALIZABLE_BULK);

        const changed =
            !result.dryRun &&
            (result.updatedIds.length > 0 || result.detachedProductCount > 0);
        if (changed) await this.cache.bustAll();

        return result;
    }

    /**
     * Permanently deletes a brand.
     *
     * Refused (409) while any product (including soft-deleted) uses it. Any
     * other FK pointing at it surfaces as P2003 and is also mapped to 409.
     * Media (logo / banner) is NOT deleted; it stays in the media library.
     */
    async remove(id: bigint) {
        await this.prisma
            .$transaction(async (tx) => {
                const brand = await tx.brand.findUnique({
                    where: { id },
                    select: { id: true },
                });
                if (!brand) {
                    throw new NotFoundException(
                        this.i18n.translate("catalog.brand.notFound"),
                    );
                }
                await this.assertUnused(tx, id);
                await tx.brand.delete({ where: { id } });
            }, SERIALIZABLE)
            .catch((e) => {
                if ((e as any)?.code === "P2003") {
                    throw new ConflictException(
                        this.i18n.translate("catalog.brand.inUse"),
                    );
                }
                throw e;
            });

        await this.cache.bustAll();
        return { success: true, id: id.toString() };
    }

    /** Paginated admin list (newest first) with slug / name search. */
    async adminList(q: BrandListInput) {
        const { take, skip, page, limit } = pageParams(q);

        const term = q.q?.trim();
        const searchIds = term ? await this.searchIds(term) : null;

        const where: Prisma.BrandWhereInput = {
            ...(q.status ? { status: q.status } : {}),
            AND: [
                ...(q.excludeIds?.length
                    ? [{ id: { notIn: q.excludeIds } }]
                    : []),
                ...(searchIds ? [{ id: { in: searchIds } }] : []),
            ],
        };

        const [items, total] = await Promise.all([
            this.prisma.brand.findMany({
                where,
                skip,
                take,
                orderBy: [
                    BRAND_ORDER_BY[q.sort as BrandSort] ??
                        BRAND_ORDER_BY.id_desc,
                    { id: "desc" },
                ],
                select: {
                    id: true,
                    slug: true,
                    name: true,
                    description: true,
                    status: true,
                    logoId: true,
                    bannerId: true,
                    createdAt: true,
                    updatedAt: true,
                    logo: { select: IMAGE_SELECT },
                    banner: { select: IMAGE_SELECT },
                    _count: {
                        select: {
                            products: { where: { deletedAt: null } },
                        },
                    },
                },
            }),
            this.prisma.brand.count({ where }),
        ]);

        return {
            items: items.map(({ logo, banner, description, _count, ...x }) => ({
                ...x,
                shortDescription: richTextMapToPlain(
                    description,
                    BRAND_SHORT_DESCRIPTION_LENGTH,
                ),
                logoUrl: logo ? this.media.urlForVariant(logo, "thumb") : null,
                bannerUrl: banner
                    ? this.media.urlForVariant(banner, "master")
                    : null,
                productCount: _count.products,
            })),
            total,
            page,
            limit,
        };
    }

    async adminGet(id: bigint) {
        const row = await this.prisma.brand.findUnique({
            where: { id },
            select: {
                id: true,
                slug: true,
                name: true,
                description: true,
                status: true,
                logoId: true,
                bannerId: true,
                logo: { select: IMAGE_SELECT },
                banner: { select: IMAGE_SELECT },
                _count: { select: { products: true } },
                createdAt: true,
                updatedAt: true,
            },
        });
        if (!row) {
            throw new NotFoundException(
                this.i18n.translate("catalog.brand.notFound"),
            );
        }

        const { logo, banner, _count, ...rest } = row;
        return {
            ...rest,
            logoUrl: logo ? this.media.urlForVariant(logo, "thumb") : null,
            bannerUrl: banner
                ? this.media.urlForVariant(banner, "master")
                : null,
            productCount: _count.products,
        };
    }

    /**
     * Ids of brands whose slug OR translated name (allowed languages only)
     * contains the term. LIKE wildcards in the term match literally.
     */
    private async searchIds(term: string): Promise<bigint[]> {
        // Escape LIKE wildcards so "50%" or "a_b" match literally.
        const pattern = `%${term.replace(/[\\%_]/g, "\\$&")}%`;

        // Only these language keys inside `name` are searched.
        const langs: string[] = [
            ...new Set([this.locale.defaultLanguage, ...this.locale.languages]),
        ];

        const rows = await this.prisma.$queryRaw<{ id: bigint }[]>`
            SELECT b."id"
            FROM "Brand" b
            WHERE b."slug" ILIKE ${pattern}
            OR EXISTS (
                SELECT 1
                FROM jsonb_each_text(b."name") AS t(lang, val)
                WHERE t.lang = ANY(${langs}::text[])
                AND t.val ILIKE ${pattern}
            )`;
        return rows.map((r) => r.id);
    }

    // ============ used by CatalogService (products) ============

    /** Ensures a brand exists AND is ACTIVE. @throws NotFoundException */
    async assertActive(id: bigint) {
        if (!(await this.isActive(id))) {
            throw new NotFoundException(
                this.i18n.translate("catalog.brand.notFound"),
            );
        }
    }

    async isActive(id: bigint) {
        const b = await this.prisma.brand.findFirst({
            where: { id, status: BrandStatus.ACTIVE },
            select: { id: true },
        });
        return !!b;
    }

    /** Brand name in every language (used for product search text). */
    async names(brandId?: bigint | null): Promise<string[]> {
        if (!brandId) return [];
        const b = await this.prisma.brand.findUnique({
            where: { id: brandId },
            select: { name: true },
        });
        return b ? (Object.values(b.name as any) as string[]) : [];
    }

    // ============ storefront ============

    /**
     * ACTIVE brands localized to `lang`, sorted by localized name.
     * Raw rows are cached (`CatalogCacheService.keys.brands`, with a lease);
     * localization and URL building happen per request.
     */
    async list(lang?: string) {
        const language = (lang ?? this.locale.defaultLanguage)
            .trim()
            .toLowerCase();

        const all = await this.cache.catalog(
            CatalogCacheService.keys.brands,
            () =>
                this.prisma.brand.findMany({
                    where: { status: BrandStatus.ACTIVE },
                    select: {
                        id: true,
                        slug: true,
                        name: true,
                        logo: {
                            select: {
                                key: true,
                                variants: true,
                                isPrivate: true,
                            },
                        },
                        banner: {
                            select: {
                                key: true,
                                variants: true,
                                isPrivate: true,
                            },
                        },
                    },
                }),
        );

        return all
            .map((b) => ({
                id: b.id,
                slug: b.slug,
                name: this.locale.pick(b.name, language) ?? "",
                logoUrl: b.logo
                    ? this.media.urlForVariant(b.logo, "thumb")
                    : null,
                bannerUrl: b.banner
                    ? this.media.urlForVariant(b.banner, "master")
                    : null,
            }))
            .sort((a, b) => a.name.localeCompare(b.name, language));
    }

    // ============ private ============

    /** Translates with named args (`{name}` placeholders). */
    private t(key: string, args?: Record<string, unknown>): string {
        return this.i18n.translate(key, args ? { args } : undefined) as string;
    }

    /** 409 carrying every blocker so the UI can resolve them in one go. */
    private blockedError(blockers: BrandStatusBlocker[]) {
        return new ConflictException({
            statusCode: 409,
            error: "Conflict",
            message:
                blockers.length === 1
                    ? blockers[0].message
                    : this.t("catalog.brand.bulkBlocked", {
                          count: blockers.length,
                      }),
            blockers,
        });
    }

    /** Products (incl. soft-deleted) per brand; only brands in use are returned. */
    private async productCountByBrand(
        tx: Prisma.TransactionClient,
        ids: bigint[],
    ): Promise<Map<string, number>> {
        if (!ids.length) return new Map();
        const groups = await tx.product.groupBy({
            by: ["brandId"],
            where: { brandId: { in: ids } },
            _count: { _all: true },
        });
        const out = new Map<string, number>();
        for (const g of groups) {
            if (g.brandId != null && g._count._all > 0) {
                out.set(g.brandId.toString(), g._count._all);
            }
        }
        return out;
    }

    /** No product (even soft-deleted, which can be restored) may use the brand. */
    private async assertUnused(tx: Prisma.TransactionClient, id: bigint) {
        const productCount = await tx.product.count({
            where: { brandId: id },
        });
        if (productCount > 0) {
            throw new ConflictException(
                this.i18n.translate("catalog.brand.inUse"),
            );
        }
    }

    /**
     * Refreshes brand-name tokens inside the `searchText` of every product
     * translation of this brand after a rename. Tokens that also occur in the
     * translation's title are kept. No-op when the name did not change.
     * Pass an empty `newName` to strip the brand tokens (brand detached).
     */
    private async reindexProductSearch(
        tx: Prisma.TransactionClient,
        brandId: bigint,
        oldName: Prisma.JsonValue,
        newName: Record<string, string>,
    ) {
        const oldToks = splitTokens(Object.values((oldName as any) ?? {}));
        const newToks = splitTokens(Object.values(newName));
        const same =
            oldToks.size === newToks.size &&
            [...oldToks].every((t) => newToks.has(t));
        if (same) return;

        const rows = await tx.productTranslation.findMany({
            where: { product: { brandId } },
            select: {
                productId: true,
                lang: true,
                title: true,
                searchText: true,
            },
        });

        for (const r of rows) {
            const titleToks = splitTokens([r.title]);
            const toks = (r.searchText ?? "")
                .split(" ")
                .filter((t) => t && !(oldToks.has(t) && !titleToks.has(t)));
            for (const t of newToks) if (!toks.includes(t)) toks.push(t);

            const next = toks.join(" ");
            if (next === r.searchText) continue;
            await tx.productTranslation.update({
                where: {
                    productId_lang: { productId: r.productId, lang: r.lang },
                },
                data: { searchText: next },
            });
        }
    }
}
