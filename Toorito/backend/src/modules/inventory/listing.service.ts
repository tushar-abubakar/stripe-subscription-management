import { AuthUser } from "@common/types/auth.type";
import { num, pageParams } from "@common/utils/helpers.util";
import { CurrencyService } from "@core/currency/currency.service";
import { PrismaService } from "@core/database/prisma.service";
import { LocaleService } from "@core/locale/locale.service";
import { RedisService } from "@core/redis/redis.service";
import {
    BulkListingStatusInput,
    BulkPriceInput,
    CatalogInput,
    ListingStatusInput,
    ListOnStoreInput,
    ProposeBarcodesInput,
    ListProductOnStoreInput,
    MovementInput,
    StockListInput,
    UpdateListingInput,
} from "./inventory.types";
import { CatalogBrowseService } from "./catalog-browse.service";
import {
    BadRequestException,
    Injectable,
    Logger,
    NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma-client/client";
import {
    ProductStatus,
    StoreListingStatus,
    StorePriceStatus,
} from "@prisma-client/enums";
import { I18nService } from "nestjs-i18n";
import {
    SNAPSHOT_VARIANT_INCLUDE,
    THUMB_SELECT,
    LISTING_INCLUDE,
    isUniqueViolation,
    LOW_STOCK_ID_CAP,
    cleanSearch,
} from "./inventory.util";
import { InventoryCacheService } from "./inventory-cache.service";
import { ListingRulesService } from "./listing-rules.service";

/** Store listings: add from catalogue, edit price / status, bulk changes, scheduled publishing. */
@Injectable()
export class ListingService {
    private readonly log = new Logger(ListingService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly redis: RedisService,
        private readonly i18n: I18nService,
        private readonly currency: CurrencyService,
        private readonly locale: LocaleService,
        private readonly browse: CatalogBrowseService,
        private readonly cache: InventoryCacheService,
        private readonly rules: ListingRulesService,
    ) {}

    // ---------------------------------------------------------------------
    // Private helpers
    // ---------------------------------------------------------------------

    /**
     * Translate a key. Interpolation values MUST be passed under `args`
     * (nestjs-i18n ignores them otherwise). Outside an HTTP request, e.g. in
     * cron jobs, the fallback language is used.
     */
    private t(key: string, args?: Record<string, string | number>): string {
        return this.i18n.translate(key, { args });
    }

    /** Propose barcodes for an already-listed variant (status unchanged). */
    async proposeBarcodes(
        storeId: bigint,
        id: bigint,
        dto: ProposeBarcodesInput,
        actor: AuthUser,
    ) {
        const sp = await this.prisma.storeProduct.findFirst({
            where: { id, storeId },
        });
        if (!sp)
            throw new NotFoundException(this.t("inventory.errors.notFound"));
        const request = await this.prisma.$transaction(async (tx) => {
            const fresh = await this.rules.planBarcodes(
                tx,
                sp.variantId,
                dto.barcodes,
            );
            if (!fresh.length)
                throw new BadRequestException({
                    message: this.t("inventory.errors.barcodesKnown"),
                    code: "BARCODES_ALREADY_KNOWN",
                });
            return this.rules.openBarcodeRequest(
                tx,
                actor,
                sp,
                sp.variantId,
                fresh,
                { gate: false, note: dto.note },
            );
        });
        return {
            success: true,
            approvalId: request.id,
            codes: (request.payload as { codes: string[] }).codes,
        };
    }

    // ---------------------------------------------------------------------
    // Catalogue browse (what the store can list)
    // ---------------------------------------------------------------------

    /**
     * Category ids allowed by categories and / or category groups (sub-categories
     * included), or null when neither is set. Both set → intersection; [] = no match.
     */
    private async categoryFilter(
        categoryIds: (number | bigint)[],
        groupIds?: (number | bigint)[],
    ): Promise<bigint[] | null> {
        const byCategory = categoryIds.length
            ? await this.browse.withDescendants(categoryIds)
            : null;
        let byGroup: bigint[] | null = null;
        if (groupIds?.length) {
            const items = await this.prisma.categoryGroupItem.findMany({
                where: { groupId: { in: groupIds.map(BigInt) } },
                select: { categoryId: true },
            });
            byGroup = items.length
                ? await this.browse.withDescendants(items.map((i) => i.categoryId))
                : [];
        }
        if (byCategory && byGroup) {
            const inGroup = new Set(byGroup.map(String));
            return byCategory.filter((id) => inGroup.has(String(id)));
        }
        return byCategory ?? byGroup;
    }

    /** PUBLISHED catalogue products with this store's listing state per product. */
    async catalog(storeId: bigint, query: CatalogInput, lang?: string) {
        const { take, skip, page, limit } = pageParams(query);
        const search = cleanSearch(query.q);

        // Categories include their sub-categories; several categories / brands = OR; groups AND-ed with categories.
        const categoryIds = await this.categoryFilter(
            [
                ...(query.categoryId ? [query.categoryId] : []),
                ...(query.categoryIds ?? []),
            ],
            query.groupIds,
        );
        const brandIds = [
            ...(query.brandId ? [query.brandId] : []),
            ...(query.brandIds ?? []),
        ].map(BigInt);
        const where: Prisma.ProductWhereInput = {
            status: ProductStatus.PUBLISHED,
            deletedAt: null,
            ...(categoryIds && { categoryId: { in: categoryIds } }),
            ...(brandIds.length && { brandId: { in: brandIds } }),
            ...(search && {
                OR: [
                    {
                        translations: {
                            some: {
                                searchText: {
                                    contains: search,
                                    mode: "insensitive",
                                },
                            },
                        },
                    },
                    {
                        variants: {
                            some: {
                                sku: { contains: search, mode: "insensitive" },
                                deletedAt: null,
                            },
                        },
                    },
                ],
            }),
            ...(query.listed === "listed" && {
                storeProducts: { some: { storeId } },
            }),
            ...(query.listed === "unlisted" && {
                storeProducts: { none: { storeId } },
            }),
            ...(query.listed === "to_add" && {
                variants: {
                    some: {
                        deletedAt: null,
                        isActive: true,
                        storeProducts: { none: { storeId } },
                    },
                },
            }),
            ...((query.status || query.stock) && {
                AND: [
                    ...(query.status
                        ? [
                              {
                                  storeProducts: {
                                      some: { storeId, status: query.status },
                                  },
                              },
                          ]
                        : []),
                    ...(query.stock === "in"
                        ? [
                              {
                                  storeProducts: {
                                      some: {
                                          storeId,
                                          availableQty: {
                                              gt: this.prisma.storeProduct
                                                  .fields.reservedQty,
                                          },
                                      },
                                  },
                              },
                          ]
                        : query.stock === "out"
                          ? [
                                { storeProducts: { some: { storeId } } },
                                {
                                    storeProducts: {
                                        none: {
                                            storeId,
                                            availableQty: {
                                                gt: this.prisma.storeProduct
                                                    .fields.reservedQty,
                                            },
                                        },
                                    },
                                },
                            ]
                          : []),
                ],
            }),
        };
        const orderBy: Prisma.ProductOrderByWithRelationInput =
            query.sort === "oldest"
                ? { id: "asc" }
                : query.sort === "name"
                  ? { slug: "asc" }
                  : query.sort === "updated"
                    ? { updatedAt: "desc" }
                    : { id: "desc" };

        const [rows, total] = await Promise.all([
            this.prisma.product.findMany({
                where,
                take,
                skip,
                orderBy,
                select: {
                    id: true,
                    slug: true,
                    translations: { select: { lang: true, title: true } },
                    thumbnail: THUMB_SELECT,
                    brand: { select: { id: true, name: true } },
                    category: { select: { id: true, name: true } },
                    _count: { select: { options: true } },
                    variants: {
                        where: { deletedAt: null, isActive: true },
                        select: { id: true, mrp: true, sku: true },
                        orderBy: { id: "asc" },
                    },
                    storeProducts: {
                        where: { storeId },
                        select: {
                            id: true,
                            variantId: true,
                            status: true,
                            sellingPrice: true,
                            availableQty: true,
                            reservedQty: true,
                            isActive: true,
                        },
                    },
                },
            }),
            this.prisma.product.count({ where }),
        ]);

        return {
            currency: this.currency.info,
            items: rows.map((p) => {
                const mrps = p.variants.map((v) => num(v.mrp));
                const listedIds = new Set(
                    p.storeProducts.map((sp) => sp.variantId.toString()),
                );
                return {
                    id: p.id,
                    slug: p.slug,
                    title: this.locale.pick(
                        this.rules.titleMap(p.translations),
                        lang,
                    ),
                    thumbnailUrl: this.rules.thumbUrl(p.thumbnail),
                    brand: p.brand
                        ? {
                              id: p.brand.id,
                              name: this.locale.pick(p.brand.name, lang),
                          }
                        : null,
                    category: p.category
                        ? {
                              id: p.category.id,
                              name: this.locale.pick(p.category.name, lang),
                          }
                        : null,
                    isVariable: p._count.options > 0 || p.variants.length > 1,
                    variantCount: p.variants.length,
                    mrp: mrps.length
                        ? {
                              min: this.currency.format(Math.min(...mrps)),
                              max: this.currency.format(Math.max(...mrps)),
                          }
                        : null,
                    store: {
                        listedVariants: p.storeProducts.length,
                        unlistedVariants: p.variants.filter(
                            (v) => !listedIds.has(v.id.toString()),
                        ).length,
                        byStatus: this.countByStatus(p.storeProducts),
                    },
                    // Every variation grouped under its product, with this store's listing (if any).
                    variants: p.variants.map((v) => {
                        const sp = p.storeProducts.find(
                            (x) => x.variantId === v.id,
                        );
                        return {
                            id: v.id,
                            sku: v.sku,
                            mrp: this.currency.format(v.mrp),
                            listing: sp
                                ? {
                                      id: sp.id,
                                      status: sp.status,
                                      isLive: sp.isActive,
                                      sellingPrice: this.currency.format(
                                          sp.sellingPrice,
                                      ),
                                      sellable: Math.max(
                                          sp.availableQty - sp.reservedQty,
                                          0,
                                      ),
                                  }
                                : null,
                        };
                    }),
                };
            }),
            total,
            page,
            limit,
        };
    }

    /** `{ DRAFT, SCHEDULED, ACTIVE, INACTIVE }` counts. */
    private countByStatus(rows: { status: StoreListingStatus }[]) {
        const counts = Object.fromEntries(
            Object.values(StoreListingStatus).map((st) => [st, 0]),
        ) as Record<StoreListingStatus, number>;
        for (const row of rows) counts[row.status]++;
        return counts;
    }

    /** One catalogue product with every variant and this store's listing for each. */
    async productListing(storeId: bigint, productId: bigint, lang?: string) {
        const product = await this.prisma.product.findFirst({
            where: { id: productId, deletedAt: null },
            select: {
                id: true,
                slug: true,
                status: true,
                translations: { select: { lang: true, title: true } },
                thumbnail: THUMB_SELECT,
                brand: { select: { id: true, name: true } },
                category: { select: { id: true, name: true } },
                _count: { select: { options: true } },
                variants: {
                    where: { deletedAt: null },
                    orderBy: [{ position: "asc" }, { id: "asc" }],
                    select: {
                        id: true,
                        sku: true,
                        mrp: true,
                        unit: true,
                        unitValue: true,
                        isActive: true,
                        optionValues: {
                            select: {
                                optionValue: { select: { label: true } },
                            },
                        },
                    },
                },
            },
        });
        if (!product)
            throw new NotFoundException(
                this.t("inventory.errors.productNotAvailable"),
            );

        const listings = await this.prisma.storeProduct.findMany({
            where: { storeId, productId },
            include: LISTING_INCLUDE,
        });
        const byVariant = new Map(
            listings.map((l) => [l.variantId.toString(), l]),
        );
        const [barcodes, gallery, changeRequests] = await Promise.all([
            this.rules.barcodeView(
                storeId,
                product.variants.map((v) => v.id),
            ),
            this.browse.gallery(product.id),
            this.browse.requestsFor(storeId, product.id),
        ]);

        const variants = product.variants.map((v) => {
            const listing = byVariant.get(v.id.toString());
            return {
                variantId: v.id,
                sku: v.sku,
                label:
                    v.optionValues
                        .map((o) => this.locale.pick(o.optionValue.label, lang))
                        .join(" / ") || null,
                unit: v.unit,
                unitValue: v.unitValue,
                mrp: this.currency.format(v.mrp),
                /** Admin switch: an inactive catalogue variant cannot be sold anywhere. */
                catalogActive: v.isActive,
                /** Approved (catalogue) codes, codes waiting for the admin, recent rejections. */
                barcodes: barcodes.get(v.id.toString()),
                /** This variation's own images / videos / audio (view only). */
                media: gallery.byVariant.get(v.id.toString()) ?? [],
                listing: listing
                    ? this.rules.presentListing(listing, lang)
                    : null,
            };
        });

        return {
            currency: this.currency.info,
            product: {
                id: product.id,
                slug: product.slug,
                status: product.status,
                title: this.locale.pick(
                    this.rules.titleMap(product.translations),
                    lang,
                ),
                thumbnailUrl: this.rules.thumbUrl(product.thumbnail),
                brand: product.brand
                    ? {
                          id: product.brand.id,
                          name: this.locale.pick(product.brand.name, lang),
                      }
                    : null,
                category: product.category
                    ? {
                          id: product.category.id,
                          name: this.locale.pick(product.category.name, lang),
                      }
                    : null,
                isVariable:
                    product._count.options > 0 || product.variants.length > 1,
                /** Product gallery: images, videos, audio in display order (view only — ask the admin for changes). */
                gallery: gallery.product,
            },
            /** This store's change requests for the product (pending + last 30 days). */
            changeRequests,
            summary: {
                variants: variants.length,
                listed: listings.length,
                live: listings.filter((l) => l.isActive).length,
                byStatus: this.countByStatus(listings),
                priceAlerts: listings.filter(
                    (l) => l.priceStatus === StorePriceStatus.MRP_RESET,
                ).length,
            },
            variants,
        };
    }

    // ---------------------------------------------------------------------
    // Listings
    // ---------------------------------------------------------------------

    /** List a single catalogue variant on a store. */
    async listOnStore(storeId: bigint, dto: ListOnStoreInput, actor: AuthUser) {
        const variant = await this.prisma.productVariant.findFirst({
            where: {
                id: BigInt(dto.variantId),
                deletedAt: null,
                isActive: true,
            },
            include: SNAPSHOT_VARIANT_INCLUDE,
        });
        if (
            !variant ||
            variant.product.status !== ProductStatus.PUBLISHED ||
            variant.product.deletedAt
        )
            throw new NotFoundException(
                this.t("inventory.errors.variantNotAvailable"),
            );
        if (dto.sellingPrice > num(variant.mrp))
            throw this.rules.priceAboveMrp(variant.mrp);
        this.rules.assertOrderQty(dto.minOrderQty, dto.maxOrderQty);
        const state = this.rules.statusData(
            dto.status ?? StoreListingStatus.ACTIVE,
            dto.publishAt,
            true,
            variant.sku,
        );

        // Fast path so the client gets the existing id back.
        const existing = await this.prisma.storeProduct.findUnique({
            where: { storeId_variantId: { storeId, variantId: variant.id } },
            select: { id: true },
        });
        if (existing) throw this.rules.alreadyListed(existing.id);

        try {
            // Listing + initial price history (+ barcode request) must succeed or fail together.
            const listing = await this.prisma.$transaction(async (tx) => {
                const fresh = await this.rules.planBarcodes(
                    tx,
                    variant.id,
                    dto.barcodes,
                );
                const sp = await this.rules.createListingTx(
                    tx,
                    storeId,
                    variant,
                    dto,
                    fresh.length ? this.rules.awaitingState() : state,
                    actor,
                );
                if (fresh.length)
                    await this.rules.openBarcodeRequest(
                        tx,
                        actor,
                        sp,
                        variant.id,
                        fresh,
                        { gate: true, state },
                    );
                return sp;
            });
            await this.cache.invalidateProducts([variant.productId]);
            return listing;
        } catch (e) {
            // Two concurrent requests passed the check above; the unique key decides.
            if (isUniqueViolation(e)) throw this.rules.alreadyListed();
            throw e;
        }
    }

    /**
     * List (or update) a whole product: simple product = one variant line,
     * variable product = any subset of its variants, each enabled / disabled.
     * New lines need a selling price; existing lines are updated in place.
     */
    async listProduct(
        storeId: bigint,
        dto: ListProductOnStoreInput,
        actor: AuthUser,
        lang?: string,
    ) {
        const productId = BigInt(dto.productId);
        const ids = dto.variants.map((v) => String(v.variantId));
        if (new Set(ids).size !== ids.length)
            throw new BadRequestException(
                this.t("inventory.errors.duplicateVariant"),
            );
        this.rules.assertOrderQty(dto.minOrderQty, dto.maxOrderQty);

        const variants = await this.prisma.productVariant.findMany({
            where: { productId, deletedAt: null },
            include: SNAPSHOT_VARIANT_INCLUDE,
        });
        const product = variants[0]?.product;
        if (
            !product ||
            product.status !== ProductStatus.PUBLISHED ||
            product.deletedAt
        )
            throw new NotFoundException(
                this.t("inventory.errors.productNotAvailable"),
            );
        const variantById = new Map(variants.map((v) => [v.id.toString(), v]));

        const settings = {
            lowStockThreshold: dto.lowStockThreshold,
            minOrderQty: dto.minOrderQty,
            maxOrderQty: dto.maxOrderQty,
            trackBatches: dto.trackBatches,
            minSellableDays: dto.minSellableDays,
            shelfLocation: dto.shelfLocation,
        };

        try {
            await this.prisma.$transaction(async (tx) => {
                const existing = new Map(
                    (
                        await tx.storeProduct.findMany({
                            where: { storeId, productId },
                        })
                    ).map((sp) => [sp.variantId.toString(), sp]),
                );

                for (const line of dto.variants) {
                    const variant = variantById.get(String(line.variantId));
                    if (!variant)
                        throw new BadRequestException(
                            this.t("inventory.errors.variantNotInProduct", {
                                id: String(line.variantId),
                            }),
                        );
                    const sp = existing.get(variant.id.toString());
                    // Status: line > product default; new listings default to ACTIVE,
                    // existing ones keep their status unless one is sent.
                    const wanted =
                        line.status ??
                        dto.status ??
                        (sp ? undefined : StoreListingStatus.ACTIVE);
                    const state = wanted
                        ? this.rules.statusData(
                              wanted,
                              dto.publishAt,
                              this.rules.catalogLive(variant, variant.product),
                              variant.sku,
                          )
                        : undefined;
                    if (sp && state) this.rules.assertNotAwaiting(sp);
                    const fresh = await this.rules.planBarcodes(
                        tx,
                        variant.id,
                        line.barcodes,
                    );
                    if (!sp) {
                        if (line.sellingPrice == null)
                            throw new BadRequestException(
                                this.t("inventory.errors.priceRequired", {
                                    sku: variant.sku,
                                }),
                            );
                        if (line.sellingPrice > num(variant.mrp))
                            throw this.rules.priceAboveMrp(variant.mrp);
                        const created = await this.rules.createListingTx(
                            tx,
                            storeId,
                            variant,
                            { ...settings, sellingPrice: line.sellingPrice },
                            fresh.length ? this.rules.awaitingState() : state!,
                            actor,
                        );
                        // New barcode: the listing waits for the admin before it can go live.
                        if (fresh.length)
                            await this.rules.openBarcodeRequest(
                                tx,
                                actor,
                                created,
                                variant.id,
                                fresh,
                                { gate: true, state: state! },
                            );
                        continue;
                    }
                    if (fresh.length) {
                        // Already listed: the barcode request doesn't change its status.
                        await this.rules.openBarcodeRequest(
                            tx,
                            actor,
                            sp,
                            variant.id,
                            fresh,
                            { gate: false },
                        );
                    }

                    // Existing listing: price / switch / shared settings.
                    const data: Prisma.StoreProductUpdateInput = {
                        ...Object.fromEntries(
                            Object.entries(settings).filter(
                                ([, v]) => v !== undefined,
                            ),
                        ),
                        ...(state ?? {}),
                    };
                    this.rules.assertOrderQty(
                        settings.minOrderQty ?? sp.minOrderQty,
                        settings.maxOrderQty ?? sp.maxOrderQty,
                    );
                    if (
                        line.sellingPrice != null &&
                        line.sellingPrice !== num(sp.sellingPrice)
                    ) {
                        const cap = this.rules.priceCap(
                            variant.mrp,
                            sp.currentMrp,
                        );
                        if (line.sellingPrice > cap)
                            throw this.rules.priceAboveMrp(cap);
                        Object.assign(data, {
                            sellingPrice: line.sellingPrice,
                            priceStatus: StorePriceStatus.CUSTOM,
                            priceResetAt: null,
                        });
                        await tx.storePriceHistory.create({
                            data: {
                                storeProductId: sp.id,
                                oldPrice: sp.sellingPrice,
                                newPrice: line.sellingPrice,
                                oldMrp: sp.currentMrp,
                                newMrp: sp.currentMrp,
                                reason: "MANUAL",
                                changedById: actor.id,
                            },
                        });
                    }
                    if (Object.keys(data).length)
                        await tx.storeProduct.update({
                            where: { id: sp.id },
                            data,
                        });
                }
            });
        } catch (e) {
            if (isUniqueViolation(e)) throw this.rules.alreadyListed();
            throw e;
        }

        await this.cache.invalidateProducts([productId]);
        return this.productListing(storeId, productId, lang);
    }

    /** Set the status (draft / scheduled / active / inactive) of one variation of a listed product. */
    async setVariantStatus(
        storeId: bigint,
        productId: bigint,
        variantId: bigint,
        dto: ListingStatusInput,
        lang?: string,
    ) {
        const sp = await this.prisma.storeProduct.findFirst({
            where: { storeId, productId, variantId },
            include: {
                variant: {
                    select: { isActive: true, deletedAt: true, sku: true },
                },
                product: { select: { status: true, deletedAt: true } },
            },
        });
        if (!sp)
            throw new NotFoundException(this.t("inventory.errors.notListed"));
        this.rules.assertNotAwaiting(sp);
        const state = this.rules.statusData(
            dto.status,
            dto.publishAt,
            this.rules.catalogLive(sp.variant, sp.product),
            sp.variant.sku,
        );

        await this.prisma.storeProduct.update({
            where: { id: sp.id },
            data: state,
        });
        await this.cache.invalidateProducts([productId]);
        return this.productListing(storeId, productId, lang);
    }

    /** Re-copy catalogue data into the snapshots of every listing of a product. */
    async resyncSnapshot(storeId: bigint, productId: bigint, lang?: string) {
        const listings = await this.prisma.storeProduct.findMany({
            where: { storeId, productId },
            select: { id: true, variantId: true },
        });
        if (!listings.length)
            throw new NotFoundException(this.t("inventory.errors.notListed"));

        const variants = await this.prisma.productVariant.findMany({
            where: { id: { in: listings.map((l) => l.variantId) } },
            include: SNAPSHOT_VARIANT_INCLUDE,
        });
        const byId = new Map(variants.map((v) => [v.id.toString(), v]));
        const now = new Date();

        await this.prisma.$transaction(
            listings
                .filter((l) => byId.has(l.variantId.toString()))
                .map((l) =>
                    this.prisma.storeProduct.update({
                        where: { id: l.id },
                        data: {
                            snapshot: this.rules.buildSnapshot(
                                byId.get(l.variantId.toString())!,
                            ) as unknown as Prisma.InputJsonValue,
                            snapshotAt: now,
                            // Category moves with the catalogue.
                            categoryId:
                                byId.get(l.variantId.toString())!.product
                                    .categoryId ?? undefined,
                        },
                    }),
                ),
        );
        return this.productListing(storeId, productId, lang);
    }

    async getListing(storeId: bigint, id: bigint, lang?: string) {
        const sp = await this.prisma.storeProduct.findFirst({
            where: { id, storeId },
            include: LISTING_INCLUDE,
        });
        if (!sp)
            throw new NotFoundException(this.t("inventory.errors.notFound"));
        const barcodes = await this.rules.barcodeView(storeId, [sp.variantId]);
        return {
            currency: this.currency.info,
            ...this.rules.presentListing(sp, lang),
            barcodes: barcodes.get(sp.variantId.toString()),
        };
    }

    async updateListing(
        storeId: bigint,
        id: bigint,
        dto: UpdateListingInput,
        actor: AuthUser,
        lang?: string,
    ) {
        // Read, validate and write in one transaction so the checks use the same data we update.
        const productId = await this.prisma.$transaction(async (tx) => {
            const sp = await tx.storeProduct.findFirst({
                where: { id, storeId },
                include: {
                    variant: {
                        select: {
                            mrp: true,
                            isActive: true,
                            deletedAt: true,
                            sku: true,
                        },
                    },
                    product: { select: { status: true, deletedAt: true } },
                },
            });
            if (!sp)
                throw new NotFoundException(
                    this.t("inventory.errors.notFound"),
                );

            const cap = this.rules.priceCap(sp.variant.mrp, sp.currentMrp);
            if (dto.sellingPrice != null && dto.sellingPrice > cap)
                throw this.rules.priceAboveMrp(cap);

            this.rules.assertOrderQty(
                dto.minOrderQty ?? sp.minOrderQty,
                dto.maxOrderQty ?? sp.maxOrderQty,
            );

            if (dto.status) this.rules.assertNotAwaiting(sp);
            const state = dto.status
                ? this.rules.statusData(
                      dto.status,
                      dto.publishAt,
                      this.rules.catalogLive(sp.variant, sp.product),
                      sp.variant.sku,
                  )
                : {};

            const priceChanged =
                dto.sellingPrice != null &&
                dto.sellingPrice !== num(sp.sellingPrice);

            await tx.storeProduct.update({
                where: { id },
                data: {
                    sellingPrice: dto.sellingPrice,
                    lowStockThreshold: dto.lowStockThreshold,
                    minOrderQty: dto.minOrderQty,
                    maxOrderQty: dto.maxOrderQty,
                    minSellableDays: dto.minSellableDays,
                    shelfLocation: dto.shelfLocation,
                    ...state,
                    // Any explicit price (even the same one) acknowledges an MRP reset.
                    ...(dto.sellingPrice != null && {
                        priceStatus: StorePriceStatus.CUSTOM,
                        priceResetAt: null,
                    }),
                },
            });
            if (priceChanged)
                await tx.storePriceHistory.create({
                    data: {
                        storeProductId: id,
                        oldPrice: sp.sellingPrice,
                        newPrice: dto.sellingPrice!,
                        oldMrp: sp.currentMrp,
                        newMrp: sp.currentMrp,
                        reason: "MANUAL",
                        changedById: actor.id,
                    },
                });
            return sp.productId;
        });
        await this.cache.invalidateProducts([productId]);
        return this.getListing(storeId, id, lang);
    }

    /** Re-price many listings in one go (all or nothing). */
    async bulkPrice(storeId: bigint, dto: BulkPriceInput, actor: AuthUser) {
        const ids = dto.items.map((i) => BigInt(i.storeProductId));
        const touched = await this.prisma.$transaction(async (tx) => {
            const rows = await tx.storeProduct.findMany({
                where: { storeId, id: { in: ids } },
                include: { variant: { select: { mrp: true, sku: true } } },
            });
            const byId = new Map(rows.map((r) => [r.id.toString(), r]));
            const products = new Set<bigint>();

            for (const item of dto.items) {
                const sp = byId.get(String(item.storeProductId));
                if (!sp)
                    throw new NotFoundException(
                        this.t("inventory.errors.listingNotInStore", {
                            id: String(item.storeProductId),
                        }),
                    );
                const cap = this.rules.priceCap(sp.variant.mrp, sp.currentMrp);
                if (item.sellingPrice > cap)
                    throw this.rules.priceAboveMrp(cap);

                await tx.storeProduct.update({
                    where: { id: sp.id },
                    data: {
                        sellingPrice: item.sellingPrice,
                        priceStatus: StorePriceStatus.CUSTOM,
                        priceResetAt: null,
                    },
                });
                if (item.sellingPrice !== num(sp.sellingPrice))
                    await tx.storePriceHistory.create({
                        data: {
                            storeProductId: sp.id,
                            oldPrice: sp.sellingPrice,
                            newPrice: item.sellingPrice,
                            oldMrp: sp.currentMrp,
                            newMrp: sp.currentMrp,
                            reason: "MANUAL",
                            changedById: actor.id,
                        },
                    });
                products.add(sp.productId);
            }
            return products;
        });
        await this.cache.invalidateProducts(touched);
        return { success: true, updated: dto.items.length };
    }

    /**
     * Set one status on many listings (by ids, or every listing of a product).
     * All or nothing: one listing that may not go live fails the whole call.
     */
    async bulkStatus(storeId: bigint, dto: BulkListingStatusInput) {
        if (!dto.storeProductIds?.length && !dto.productId)
            throw new BadRequestException({
                message: this.t("inventory.errors.bulkTargetRequired"),
                code: "BULK_TARGET_REQUIRED",
            });

        const rows = await this.prisma.storeProduct.findMany({
            where: {
                storeId,
                ...(dto.storeProductIds?.length && {
                    id: { in: dto.storeProductIds.map((id) => BigInt(id)) },
                }),
                ...(dto.productId && { productId: BigInt(dto.productId) }),
            },
            include: {
                variant: {
                    select: { isActive: true, deletedAt: true, sku: true },
                },
                product: { select: { status: true, deletedAt: true } },
            },
        });
        const found = new Set(rows.map((r) => r.id.toString()));
        const missing = (dto.storeProductIds ?? []).find(
            (id) => !found.has(String(id)),
        );
        if (missing !== undefined || !rows.length)
            throw new NotFoundException(
                this.t("inventory.errors.listingNotInStore", {
                    id: String(missing ?? dto.productId),
                }),
            );

        // Validate everything first, then write.
        rows.forEach((r) => this.rules.assertNotAwaiting(r));
        const updates = rows.map((r) => ({
            id: r.id,
            data: this.rules.statusData(
                dto.status,
                dto.publishAt,
                this.rules.catalogLive(r.variant, r.product),
                r.variant.sku,
            ),
        }));
        await this.prisma.$transaction(
            updates.map((u) =>
                this.prisma.storeProduct.update({
                    where: { id: u.id },
                    data: u.data,
                }),
            ),
        );
        await this.cache.invalidateProducts(rows.map((r) => r.productId));
        return {
            success: true,
            updated: rows.length,
            status: dto.status,
            publishAt: updates[0]?.data.publishAt ?? null,
        };
    }

    /**
     * SCHEDULED → ACTIVE once `publishAt` has passed. Runs every minute on one
     * instance. A listing whose catalogue item is no longer live goes INACTIVE.
     */
    async publishScheduled() {
        const unlock = await this.redis.lock("cron:listing-publish", 55);
        if (!unlock) return;
        try {
            const due = await this.prisma.storeProduct.findMany({
                where: {
                    status: StoreListingStatus.SCHEDULED,
                    publishAt: { lte: new Date() },
                },
                take: 1000,
                select: {
                    id: true,
                    productId: true,
                    variant: { select: { isActive: true, deletedAt: true } },
                    product: { select: { status: true, deletedAt: true } },
                },
            });
            if (!due.length) return;

            const live = due.filter((d) =>
                this.rules.catalogLive(d.variant, d.product),
            );
            const blocked = due.filter(
                (d) => !this.rules.catalogLive(d.variant, d.product),
            );
            // `status: SCHEDULED` in the filter: a manager edit in between wins.
            await this.prisma.$transaction([
                this.prisma.storeProduct.updateMany({
                    where: {
                        id: { in: live.map((d) => d.id) },
                        status: StoreListingStatus.SCHEDULED,
                    },
                    data: {
                        status: StoreListingStatus.ACTIVE,
                        isActive: true,
                        publishAt: null,
                    },
                }),
                this.prisma.storeProduct.updateMany({
                    where: {
                        id: { in: blocked.map((d) => d.id) },
                        status: StoreListingStatus.SCHEDULED,
                    },
                    data: {
                        status: StoreListingStatus.INACTIVE,
                        isActive: false,
                        publishAt: null,
                    },
                }),
            ]);
            await this.cache.invalidateProducts(due.map((d) => d.productId));
            this.log.log(
                `Scheduled listings: ${live.length} went live, ${blocked.length} set INACTIVE (catalogue not live)`,
            );
        } catch (e) {
            this.log.warn(`publishScheduled failed: ${(e as Error).message}`);
        } finally {
            await unlock();
        }
    }

    async priceHistory(storeId: bigint, id: bigint, query: MovementInput) {
        const sp = await this.prisma.storeProduct.findFirst({
            where: { id, storeId },
            select: { id: true },
        });
        if (!sp)
            throw new NotFoundException(this.t("inventory.errors.notFound"));
        const { take, skip, page, limit } = pageParams(query);
        const where = { storeProductId: id };
        const [rows, total] = await Promise.all([
            this.prisma.storePriceHistory.findMany({
                where,
                orderBy: { id: "desc" },
                take,
                skip,
            }),
            this.prisma.storePriceHistory.count({ where }),
        ]);
        return {
            currency: this.currency.info,
            items: rows.map((r) => ({
                ...r,
                oldPrice: this.currency.format(r.oldPrice),
                newPrice: this.currency.format(r.newPrice),
                oldMrp: this.currency.formatOrNull(r.oldMrp),
                newMrp: this.currency.formatOrNull(r.newMrp),
            })),
            total,
            page,
            limit,
        };
    }

    // ---------------------------------------------------------------------
    // Queries
    // ---------------------------------------------------------------------

    async listStock(storeId: bigint, query: StockListInput, lang?: string) {
        const { take, skip, page, limit } = pageParams(query);

        // Prisma cannot compare two columns in `where`, so these ids come
        // from raw SQL. Tagged templates bind every `${}` as a parameter (no
        // SQL injection). The id list is capped so a huge store cannot blow
        // up the following `IN (...)` query.
        let stockIds: bigint[] | undefined;
        if (query.stock && query.stock !== "reserved") {
            const condition =
                query.stock === "out"
                    ? Prisma.sql`"availableQty" - "reservedQty" <= 0`
                    : query.stock === "in"
                      ? Prisma.sql`"availableQty" - "reservedQty" > 0`
                      : Prisma.sql`"availableQty" - "reservedQty" <= "lowStockThreshold"`;
            const rows = await this.prisma.$queryRaw<{ id: bigint }[]>`
                SELECT id FROM "StoreProduct"
                WHERE "storeId" = ${storeId} AND ${condition}
                ORDER BY id DESC
                LIMIT ${LOW_STOCK_ID_CAP}`;
            stockIds = rows.map((row) => row.id);
        }

        const search = cleanSearch(query.q);
        const categoryIds = await this.categoryFilter(query.categoryIds ?? [], query.groupIds);
        const where: Prisma.StoreProductWhereInput = {
            storeId,
            ...(stockIds && { id: { in: stockIds } }),
            ...(query.stock === "reserved" && { reservedQty: { gt: 0 } }),
            ...(query.categoryId && { categoryId: BigInt(query.categoryId) }),
            ...(categoryIds && {
                AND: [{ categoryId: { in: categoryIds } }],
            }),
            ...(query.brandIds?.length && {
                product: { brandId: { in: query.brandIds.map(BigInt) } },
            }),
            ...(query.productId && { productId: BigInt(query.productId) }),
            ...(query.priceStatus && { priceStatus: query.priceStatus }),
            ...(query.status && { status: query.status }),
            ...(query.isActive !== undefined && { isActive: query.isActive }),
            ...(search && {
                OR: [
                    {
                        product: {
                            translations: {
                                some: {
                                    searchText: {
                                        contains: search,
                                        mode: "insensitive",
                                    },
                                },
                            },
                        },
                    },
                    {
                        variant: {
                            sku: { contains: search, mode: "insensitive" },
                        },
                    },
                ],
            }),
        };

        const [items, total] = await Promise.all([
            this.prisma.storeProduct.findMany({
                where,
                take,
                skip,
                orderBy: { id: "desc" },
                include: LISTING_INCLUDE,
            }),
            this.prisma.storeProduct.count({ where }),
        ]);

        return {
            currency: this.currency.info,
            items: items.map((listing) =>
                this.rules.presentListing(listing, lang),
            ),
            total,
            page,
            limit,
        };
    }
}
