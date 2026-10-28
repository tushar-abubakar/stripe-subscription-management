import {
    addDays,
    localDateString,
    pageParams,
    todayInTz,
    zonedStartOfDay,
} from "@common/utils/helpers.util";
import { AppConfig } from "@config/config.type";
import { CurrencyService } from "@core/currency/currency.service";
import { PrismaService } from "@core/database/prisma.service";
import { LocaleService } from "@core/locale/locale.service";
import {
    LedgerInput,
    LowStockInput,
    EXPIRY_BUCKETS,
    ExpiryInput,
} from "./inventory.types";
import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Prisma } from "@prisma-client/client";
import { BatchStatus } from "@prisma-client/enums";
import { LISTING_INCLUDE } from "./inventory.util";
import { InventoryCacheService } from "./inventory-cache.service";
import { ListingRulesService } from "./listing-rules.service";

/** Read-only inventory reports: ledger, summary, expiry, low stock, admin overview. */
@Injectable()
export class InventoryReportService {
    private readonly settings: AppConfig["inventory"];

    constructor(
        private readonly prisma: PrismaService,
        private readonly config: ConfigService,
        private readonly currency: CurrencyService,
        private readonly locale: LocaleService,
        private readonly cache: InventoryCacheService,
        private readonly rules: ListingRulesService,
    ) {
        this.settings =
            this.config.getOrThrow<AppConfig["inventory"]>("inventory");
    }

    /** Active batches that expire within `requestedDays` days (default and cap come from config). */
    async expiring(storeId: bigint, requestedDays?: number) {
        const days = Math.min(
            requestedDays ?? this.settings.expiringDefaultDays,
            this.settings.expiringMaxDays,
        );
        const tz = await this.cache.storeTz(this.prisma, storeId);

        return this.prisma.inventoryBatch.findMany({
            where: {
                storeId,
                status: BatchStatus.ACTIVE,
                availableQty: { gt: 0 },
                expiryDate: { lte: addDays(todayInTz(tz), days) },
            },
            orderBy: { expiryDate: "asc" },
            take: this.settings.expiringLimit,
            include: {
                storeProduct: {
                    select: {
                        productId: true,
                        variantId: true,
                        variant: { select: { sku: true } },
                    },
                },
            },
        });
    }

    /** Store-wide stock ledger (append-only). Dates are calendar days in the store's timezone. */
    async ledger(storeId: bigint, query: LedgerInput, lang?: string) {
        const { take, skip, page, limit } = pageParams(query);
        const tz = await this.cache.storeTz(this.prisma, storeId);
        const where: Prisma.StockMovementWhereInput = {
            storeId,
            ...(query.storeProductId && {
                storeProductId: BigInt(query.storeProductId),
            }),
            ...(query.types?.length && { type: { in: query.types } }),
            ...((query.from || query.to) && {
                createdAt: {
                    ...(query.from && { gte: zonedStartOfDay(query.from, tz) }),
                    ...(query.to && {
                        lt: addDays(zonedStartOfDay(query.to, tz), 1),
                    }),
                },
            }),
        };

        const [rows, total] = await Promise.all([
            this.prisma.stockMovement.findMany({
                where,
                orderBy: { id: "desc" },
                take,
                skip,
            }),
            this.prisma.stockMovement.count({ where }),
        ]);

        // The ledger has no FKs: resolve listing titles and actor names in two queries.
        const [listings, actors] = await Promise.all([
            this.prisma.storeProduct.findMany({
                where: {
                    id: { in: [...new Set(rows.map((r) => r.storeProductId))] },
                },
                select: {
                    id: true,
                    variant: { select: { sku: true } },
                    product: {
                        select: {
                            translations: {
                                select: { lang: true, title: true },
                            },
                        },
                    },
                },
            }),
            this.prisma.user.findMany({
                where: {
                    id: {
                        in: [
                            ...new Set(
                                rows
                                    .map((r) => r.actorId)
                                    .filter((id): id is bigint => id != null),
                            ),
                        ],
                    },
                },
                select: { id: true, name: true, role: true },
            }),
        ]);
        const listingById = new Map(listings.map((l) => [l.id.toString(), l]));
        const actorById = new Map(actors.map((a) => [a.id.toString(), a]));

        return {
            items: rows.map((r) => {
                const l = listingById.get(r.storeProductId.toString());
                return {
                    ...r,
                    unitCost: this.currency.formatOrNull(r.unitCost),
                    listing: l
                        ? {
                              id: l.id,
                              sku: l.variant.sku,
                              title: this.locale.pick(
                                  this.rules.titleMap(l.product.translations),
                                  lang,
                              ),
                          }
                        : null,
                    actor: r.actorId
                        ? (actorById.get(r.actorId.toString()) ?? null)
                        : null,
                };
            }),
            total,
            page,
            limit,
        };
    }

    /** Stock health of one store: counts, units, value, alerts and today's flow. */
    async summary(storeId: bigint) {
        const tz = await this.cache.storeTz(this.prisma, storeId);
        const today = todayInTz(tz);
        const dayStart = zonedStartOfDay(localDateString(tz), tz);
        const expiringBy = addDays(today, this.settings.expiringDefaultDays);

        const [[stock], [value], expiring, quarantined, flow] =
            await Promise.all([
                this.prisma.$queryRaw<any[]>`
                SELECT COUNT(*)::int AS "listings",
                       COUNT(*) FILTER (WHERE "isActive")::int AS "live",
                       COUNT(*) FILTER (WHERE status = 'ACTIVE')::int AS "active",
                       COUNT(*) FILTER (WHERE status = 'INACTIVE')::int AS "inactive",
                       COUNT(*) FILTER (WHERE status = 'DRAFT')::int AS "draft",
                       COUNT(*) FILTER (WHERE status = 'SCHEDULED')::int AS "scheduled",
                       COUNT(*) FILTER (WHERE "isActive" AND "availableQty" - "reservedQty" <= 0)::int AS "outOfStock",
                       COUNT(*) FILTER (WHERE "isActive" AND "availableQty" - "reservedQty" > 0
                                          AND "availableQty" - "reservedQty" <= "lowStockThreshold")::int AS "lowStock",
                       COUNT(*) FILTER (WHERE "priceStatus" = 'MRP_RESET')::int AS "priceAlerts",
                       COALESCE(SUM("availableQty"), 0)::int AS "onHandUnits",
                       COALESCE(SUM("reservedQty"), 0)::int AS "reservedUnits",
                       COALESCE(SUM("availableQty" * "sellingPrice"), 0) AS "retailValue"
                FROM "StoreProduct" WHERE "storeId" = ${storeId}`,
                this.prisma.$queryRaw<any[]>`
                SELECT COALESCE(SUM("availableQty" * COALESCE("costPrice", 0)), 0) AS "costValue"
                FROM "InventoryBatch"
                WHERE "storeId" = ${storeId} AND status = 'ACTIVE'::"BatchStatus"`,
                this.prisma.inventoryBatch.count({
                    where: {
                        storeId,
                        status: BatchStatus.ACTIVE,
                        availableQty: { gt: 0 },
                        expiryDate: { lte: expiringBy },
                    },
                }),
                this.prisma.inventoryBatch.count({
                    where: {
                        storeId,
                        status: BatchStatus.QUARANTINE,
                        availableQty: { gt: 0 },
                    },
                }),
                this.prisma.stockMovement.groupBy({
                    by: ["type"],
                    where: { storeId, createdAt: { gte: dayStart } },
                    _sum: { quantity: true },
                    _count: { _all: true },
                }),
            ]);

        return {
            currency: this.currency.info,
            timezone: tz,
            listings: {
                total: stock.listings,
                /** Visible on the storefront now (ACTIVE and catalogue live). */
                live: stock.live,
                byStatus: {
                    DRAFT: stock.draft,
                    SCHEDULED: stock.scheduled,
                    ACTIVE: stock.active,
                    INACTIVE: stock.inactive,
                },
                /** ACTIVE but hidden because the admin unpublished / disabled the catalogue item. */
                catalogBlocked: stock.active - stock.live,
                outOfStock: stock.outOfStock,
                lowStock: stock.lowStock,
                priceAlerts: stock.priceAlerts,
            },
            units: {
                onHand: stock.onHandUnits,
                reserved: stock.reservedUnits,
                sellable: stock.onHandUnits - stock.reservedUnits,
            },
            value: {
                retail: this.currency.format(stock.retailValue),
                cost: this.currency.format(value.costValue),
            },
            batches: {
                expiringSoon: expiring,
                expiringWithinDays: this.settings.expiringDefaultDays,
                quarantined,
            },
            today: Object.fromEntries(
                flow.map((f) => [
                    f.type,
                    {
                        movements: f._count._all,
                        quantity: f._sum.quantity ?? 0,
                    },
                ]),
            ),
        };
    }

    // ---------------------------------------------------------------------
    // Admin: cross-store overview
    // ---------------------------------------------------------------------

    /** One row per store with its stock health — the admin's store picker. */
    async overview(
        query: { page?: number; limit?: number; q?: string },
        lang?: string,
    ) {
        const { take, skip, page, limit } = pageParams(query);
        const q = query.q?.trim();
        const where: Prisma.StoreWhereInput = q
            ? {
                  OR: [
                      { code: { contains: q, mode: "insensitive" } },
                      { nameSearch: { contains: q.toLowerCase() } },
                      { city: { contains: q, mode: "insensitive" } },
                  ],
              }
            : {};
        const [stores, total] = await Promise.all([
            this.prisma.store.findMany({
                where,
                orderBy: { id: "asc" },
                take,
                skip,
                select: {
                    id: true,
                    code: true,
                    name: true,
                    city: true,
                    status: true,
                    isOpen: true,
                    acceptingOrders: true,
                },
            }),
            this.prisma.store.count({ where }),
        ]);
        const ids = stores.map((s) => s.id);
        const stats = ids.length
            ? await this.prisma.$queryRaw<any[]>`
                SELECT "storeId",
                       COUNT(*)::int AS "listings",
                       COUNT(*) FILTER (WHERE "isActive")::int AS "active",
                       COUNT(*) FILTER (WHERE status = 'DRAFT')::int AS "draft",
                       COUNT(*) FILTER (WHERE status = 'SCHEDULED')::int AS "scheduled",
                       COUNT(*) FILTER (WHERE "isActive" AND "availableQty" - "reservedQty" <= 0)::int AS "outOfStock",
                       COUNT(*) FILTER (WHERE "isActive" AND "availableQty" - "reservedQty" > 0
                                          AND "availableQty" - "reservedQty" <= "lowStockThreshold")::int AS "lowStock",
                       COUNT(*) FILTER (WHERE "priceStatus" = 'MRP_RESET')::int AS "priceAlerts",
                       COALESCE(SUM("availableQty" * "sellingPrice"), 0) AS "retailValue"
                FROM "StoreProduct"
                WHERE "storeId" IN (${Prisma.join(ids)})
                GROUP BY "storeId"`
            : [];
        const byStore = new Map(stats.map((s) => [String(s.storeId), s]));

        return {
            currency: this.currency.info,
            items: stores.map((s) => {
                const st = byStore.get(s.id.toString());
                return {
                    ...s,
                    name: this.locale.pick(s.name, lang),
                    inventory: {
                        listings: st?.listings ?? 0,
                        active: st?.active ?? 0,
                        draft: st?.draft ?? 0,
                        scheduled: st?.scheduled ?? 0,
                        outOfStock: st?.outOfStock ?? 0,
                        lowStock: st?.lowStock ?? 0,
                        priceAlerts: st?.priceAlerts ?? 0,
                        retailValue: this.currency.format(st?.retailValue ?? 0),
                    },
                };
            }),
            total,
            page,
            limit,
        };
    }

    // ---------------------------------------------------------------------
    // Expiry buckets & low stock
    // ---------------------------------------------------------------------

    /**
     * Stock grouped by days to expiry (store-local today). Without `bucket`:
     * totals per bucket; with `bucket`: that bucket's batches, soonest first.
     */
    async expiryBuckets(storeId: bigint, q: ExpiryInput, lang?: string) {
        const tz = await this.cache.storeTz(this.prisma, storeId);
        const today = localDateString(tz);
        const bucketSql = Prisma.sql`
            CASE
              WHEN b.status = 'EXPIRED' OR (b."expiryDate" IS NOT NULL AND b."expiryDate" < ${today}::date) THEN 'EXPIRED'
              WHEN b."expiryDate" IS NULL THEN 'NO_EXPIRY'
              WHEN b."expiryDate" - ${today}::date <= 3 THEN 'DAYS_0_3'
              WHEN b."expiryDate" - ${today}::date <= 7 THEN 'DAYS_4_7'
              WHEN b."expiryDate" - ${today}::date <= 15 THEN 'DAYS_8_15'
              WHEN b."expiryDate" - ${today}::date <= 30 THEN 'DAYS_16_30'
              WHEN b."expiryDate" - ${today}::date <= 90 THEN 'DAYS_31_90'
              ELSE 'DAYS_90_PLUS'
            END`;
        const base = Prisma.sql`
            FROM "InventoryBatch" b JOIN "StoreProduct" sp ON sp.id = b."storeProductId"
            WHERE b."storeId" = ${storeId} AND b."availableQty" > 0
              AND b.status IN ('ACTIVE', 'QUARANTINE', 'EXPIRED')`;

        const totals = await this.prisma.$queryRaw<any[]>`
            SELECT ${bucketSql} AS bucket, COUNT(*)::int AS batches, SUM(b."availableQty")::int AS units,
                   COALESCE(SUM(b."availableQty" * COALESCE(b."costPrice", 0)), 0) AS cost,
                   COALESCE(SUM(b."availableQty" * sp."sellingPrice"), 0) AS retail
            ${base} GROUP BY 1`;
        const byBucket = new Map(totals.map((t) => [t.bucket, t]));
        const buckets = EXPIRY_BUCKETS.map((key) => {
            const t = byBucket.get(key);
            return {
                bucket: key,
                batches: t?.batches ?? 0,
                units: t?.units ?? 0,
                costValue: this.currency.format(t?.cost ?? 0),
                retailValue: this.currency.format(t?.retail ?? 0),
            };
        });
        if (!q.bucket)
            return {
                timezone: tz,
                today,
                currency: this.currency.info,
                buckets,
            };

        const { take, skip, page, limit } = pageParams(q);
        const ids = await this.prisma.$queryRaw<{ id: bigint }[]>`
            SELECT b.id ${base} AND ${bucketSql} = ${q.bucket}
            ORDER BY b."expiryDate" ASC NULLS LAST, b.id LIMIT ${take} OFFSET ${skip}`;
        const batches = await this.prisma.inventoryBatch.findMany({
            where: { id: { in: ids.map((r) => r.id) } },
            orderBy: [
                { expiryDate: { sort: "asc", nulls: "last" } },
                { id: "asc" },
            ],
            include: {
                storeProduct: {
                    select: {
                        id: true,
                        sellingPrice: true,
                        status: true,
                        variant: { select: { sku: true } },
                        product: {
                            select: {
                                translations: {
                                    select: { lang: true, title: true },
                                },
                            },
                        },
                    },
                },
            },
        });
        return {
            timezone: tz,
            today,
            currency: this.currency.info,
            buckets,
            bucket: q.bucket,
            items: batches.map(({ storeProduct: sp, ...b }) => ({
                ...b,
                mrp: this.currency.format(b.mrp),
                costPrice: this.currency.formatOrNull(b.costPrice),
                clearancePrice: this.currency.formatOrNull(b.clearancePrice),
                daysToExpiry: b.expiryDate
                    ? Math.round(
                          (b.expiryDate.getTime() -
                              Date.parse(`${today}T00:00:00Z`)) /
                              86400000,
                      )
                    : null,
                listing: {
                    id: sp.id,
                    sku: sp.variant.sku,
                    title: this.locale.pick(
                        this.rules.titleMap(sp.product.translations),
                        lang,
                    ),
                    status: sp.status,
                    sellingPrice: this.currency.format(sp.sellingPrice),
                },
            })),
            total: byBucket.get(q.bucket)?.batches ?? 0,
            page,
            limit,
        };
    }

    /**
     * Low-stock listings (sellable <= threshold) with sales velocity, days
     * of stock left and a suggested reorder quantity.
     */
    async lowStock(storeId: bigint, q: LowStockInput, lang?: string) {
        const { take, skip, page, limit } = pageParams(q);
        const days = q.days ?? 14;
        const cover = q.coverDays ?? 7;
        const since = new Date(Date.now() - days * 86400000);
        const where = Prisma.sql`
            sp."storeId" = ${storeId} AND sp.status IN ('ACTIVE', 'SCHEDULED')
            AND sp."availableQty" - sp."reservedQty" <= sp."lowStockThreshold"`;
        const sales = Prisma.sql`
            SELECT oi."storeProductId" AS spid, SUM(oi.quantity)::int AS qty
            FROM "OrderItem" oi JOIN "Order" o ON o.id = oi."orderId"
            WHERE o."storeId" = ${storeId} AND o."placedAt" >= ${since}
              AND o.status NOT IN ('PENDING_PAYMENT', 'CANCELLED', 'REJECTED', 'FAILED')
            GROUP BY 1`;
        const [rows, [{ total }]] = await Promise.all([
            this.prisma.$queryRaw<any[]>`
                WITH sales AS (${sales})
                SELECT sp.id, (sp."availableQty" - sp."reservedQty")::int AS sellable, sp."lowStockThreshold" AS threshold,
                       COALESCE(s.qty, 0)::int AS sold
                FROM "StoreProduct" sp LEFT JOIN sales s ON s.spid = sp.id
                WHERE ${where}
                ORDER BY (sp."availableQty" - sp."reservedQty") - COALESCE(s.qty, 0)::numeric / ${days} ASC, sp.id
                LIMIT ${take} OFFSET ${skip}`,
            this.prisma.$queryRaw<
                { total: number }[]
            >`SELECT COUNT(*)::int AS total FROM "StoreProduct" sp WHERE ${where}`,
        ]);
        const listings = await this.prisma.storeProduct.findMany({
            where: { id: { in: rows.map((r) => r.id) } },
            include: LISTING_INCLUDE,
        });
        const lastSupplier = await this.prisma.$queryRaw<
            {
                spid: bigint;
                supplierName: string;
                receivedAt: Date;
                costPrice: unknown;
            }[]
        >`
            SELECT DISTINCT ON (gi."storeProductId") gi."storeProductId" AS spid, g."supplierName", g."receivedAt", gi."costPrice"
            FROM "GoodsReceiptItem" gi JOIN "GoodsReceipt" g ON g.id = gi."goodsReceiptId"
            WHERE gi."storeProductId" IN (${rows.length ? Prisma.join(rows.map((r) => r.id)) : Prisma.sql`NULL`})
            ORDER BY gi."storeProductId", g."receivedAt" DESC`;
        const byId = new Map(listings.map((l) => [l.id.toString(), l]));
        const supplierBy = new Map(
            lastSupplier.map((r) => [r.spid.toString(), r]),
        );
        return {
            currency: this.currency.info,
            window: { days, coverDays: cover },
            items: rows.map((r) => {
                const velocity = r.sold / days;
                const suggested = Math.max(
                    Math.ceil(
                        (velocity > 0 ? velocity * cover : 0) +
                            r.threshold +
                            1 -
                            r.sellable,
                    ),
                    0,
                );
                const sup = supplierBy.get(String(r.id));
                return {
                    ...this.rules.presentListing(byId.get(String(r.id))!, lang),
                    soldInWindow: r.sold,
                    dailyVelocity: Math.round(velocity * 100) / 100,
                    daysOfStockLeft:
                        velocity > 0
                            ? Math.round((r.sellable / velocity) * 10) / 10
                            : null,
                    suggestedReorderQty: suggested,
                    lastSupplier: sup
                        ? {
                              name: sup.supplierName,
                              receivedAt: sup.receivedAt,
                              costPrice: this.currency.formatOrNull(
                                  sup.costPrice,
                              ),
                          }
                        : null,
                };
            }),
            total,
            page,
            limit,
        };
    }
}
