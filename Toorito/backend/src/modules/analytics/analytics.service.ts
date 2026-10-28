import {
    localDateString,
    num,
    zonedStartOfDay,
} from "@common/utils/helpers.util";
import { CurrencyService } from "@core/currency/currency.service";
import { PrismaService } from "@core/database/prisma.service";
import { LocaleService } from "@core/locale/locale.service";
import { RedisService } from "@core/redis/redis.service";
import {
    AnalyticsInput,
    Breakdown,
    BreakdownInput,
    CustomerAnalyticsInput,
    Granularity,
    OverviewInput,
    ProductAnalyticsInput,
    SalesSeriesInput,
    SlowMoversInput,
    StoreLeaderboardInput,
} from "./analytics.types";
import {
    BadRequestException,
    Injectable,
    NotFoundException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Prisma } from "@prisma-client/client";
import { I18nService } from "nestjs-i18n";

/** Resolved reporting window: store-local calendar days + their UTC bounds. */
export interface Window {
    tz: string;
    from: string;
    to: string;
    days: number;
    start: Date;
    end: Date;
    prev: { from: string; to: string; start: Date; end: Date };
}

/** Longest window one request may cover. */
const MAX_DAYS = 366;

/** Orders that count as sales (paid or payable, not failed / cancelled). */
const VALID = Prisma.sql`o.status NOT IN ('PENDING_PAYMENT','CANCELLED','REJECTED','FAILED')`;
const CANCELLED = Prisma.sql`o.status IN ('CANCELLED','REJECTED','FAILED')`;
/** Every order the customer actually placed (online-payment drafts excluded). */
const PLACED = Prisma.sql`o.status <> 'PENDING_PAYMENT'`;

const STEP: Record<Granularity, string> = {
    hour: "1 hour",
    day: "1 day",
    week: "1 week",
    month: "1 month",
};

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** "2026-10-20" + n days. */
const shiftDay = (day: string, n: number) =>
    new Date(Date.parse(`${day}T00:00:00Z`) + n * 86400000)
        .toISOString()
        .slice(0, 10);

const dayDiff = (from: string, to: string) =>
    Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000);

const round = (v: unknown, digits = 2) =>
    v == null ? null : Math.round(Number(v) * 10 ** digits) / 10 ** digits;

/** % change from `prev` to `cur` (null when there is no base). */
const pctChange = (cur: number, prev: number) =>
    prev === 0 ? (cur === 0 ? 0 : null) : round(((cur - prev) / prev) * 100, 1);

const maskPhone = (phone: string) =>
    phone.length > 7 ? `${phone.slice(0, 4)}${"*".repeat(phone.length - 7)}${phone.slice(-3)}` : phone;

@Injectable()
export class AnalyticsService {
    private readonly defaultTz: string;

    constructor(
        private readonly prisma: PrismaService,
        private readonly redis: RedisService,
        private readonly currency: CurrencyService,
        private readonly locale: LocaleService,
        private readonly i18n: I18nService,
        config: ConfigService,
    ) {
        this.defaultTz = config.getOrThrow<string>("app.timezone");
    }

    // ---------------------------------------------------------------------
    // Window & SQL helpers
    // ---------------------------------------------------------------------

    private async storeTz(storeId: bigint) {
        const store = await this.prisma.store.findUnique({
            where: { id: storeId },
            select: { timezone: true },
        });
        if (!store)
            throw new NotFoundException(this.i18n.translate("stores.errors.notFound"));
        return store.timezone;
    }

    /** Turns `period` / `from` / `to` into store-local days and UTC instants. */
    resolveWindow(q: AnalyticsInput, tz: string): Window {
        const today = localDateString(tz);
        const mondayOffset = (new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7;
        const period = q.from ? "custom" : (q.period ?? "last_7_days");

        let from: string;
        let to: string = today;
        switch (period) {
            case "today":
                from = today;
                break;
            case "yesterday":
                from = to = shiftDay(today, -1);
                break;
            case "last_30_days":
                from = shiftDay(today, -29);
                break;
            case "this_week":
                from = shiftDay(today, -mondayOffset);
                break;
            case "last_week":
                from = shiftDay(today, -mondayOffset - 7);
                to = shiftDay(today, -mondayOffset - 1);
                break;
            case "this_month":
                from = `${today.slice(0, 7)}-01`;
                break;
            case "last_month": {
                to = shiftDay(`${today.slice(0, 7)}-01`, -1);
                from = `${to.slice(0, 7)}-01`;
                break;
            }
            case "custom":
                from = (q.from ?? shiftDay(today, -6)).slice(0, 10);
                to = (q.to ?? today).slice(0, 10);
                break;
            default:
                from = shiftDay(today, -6);
        }

        if (from > to)
            throw new BadRequestException({
                message: this.i18n.translate("analytics.errors.fromAfterTo"),
                code: "FROM_AFTER_TO",
            });
        const days = dayDiff(from, to) + 1;
        if (days > MAX_DAYS)
            throw new BadRequestException({
                message: this.i18n.translate("analytics.errors.rangeTooLong", { args: { max: MAX_DAYS } }),
                code: "RANGE_TOO_LONG",
            });

        const prevTo = shiftDay(from, -1);
        const prevFrom = shiftDay(from, -days);
        return {
            tz,
            from,
            to,
            days,
            start: zonedStartOfDay(from, tz),
            end: zonedStartOfDay(shiftDay(to, 1), tz),
            prev: {
                from: prevFrom,
                to: prevTo,
                start: zonedStartOfDay(prevFrom, tz),
                end: zonedStartOfDay(from, tz),
            },
        };
    }

    /** WHERE fragment on `"Order" o` for one store (or all) + window + filters. */
    private scope(
        storeId: bigint | null,
        start: Date,
        end: Date,
        q: AnalyticsInput,
    ) {
        return Prisma.sql`o."placedAt" >= ${start} AND o."placedAt" < ${end}
            ${storeId == null ? Prisma.empty : Prisma.sql`AND o."storeId" = ${storeId}`}
            ${q.paymentMethod ? Prisma.sql`AND o."paymentMethod" = ${q.paymentMethod}::"PaymentMethod"` : Prisma.empty}
            ${q.source ? Prisma.sql`AND o.source = ${q.source}::"OrderSource"` : Prisma.empty}`;
    }

    /** Store-local timestamp of `o."placedAt"` (stored as UTC without zone). */
    private local(tz: string) {
        return Prisma.sql`(o."placedAt" AT TIME ZONE 'UTC' AT TIME ZONE ${tz})`;
    }

    private window(w: Window) {
        return { from: w.from, to: w.to, days: w.days, timezone: w.tz };
    }

    // ---------------------------------------------------------------------
    // Overview (KPIs)
    // ---------------------------------------------------------------------

    private async kpis(storeId: bigint | null, start: Date, end: Date, q: AnalyticsInput) {
        const where = this.scope(storeId, start, end, q);
        const [[o], [items], [cust]] = await Promise.all([
            this.prisma.$queryRaw<any[]>`
                SELECT
                  COUNT(*) FILTER (WHERE ${PLACED})::int                         AS "orders",
                  COUNT(*) FILTER (WHERE ${VALID})::int                          AS "validOrders",
                  COUNT(*) FILTER (WHERE o.status = 'DELIVERED')::int            AS "delivered",
                  COUNT(*) FILTER (WHERE ${CANCELLED})::int                      AS "cancelled",
                  COALESCE(SUM(o.total) FILTER (WHERE ${VALID}), 0)              AS "grossSales",
                  COALESCE(SUM(o.subtotal) FILTER (WHERE ${VALID}), 0)           AS "itemSales",
                  COALESCE(SUM(o."discountTotal") FILTER (WHERE ${VALID}), 0)    AS "discounts",
                  COALESCE(SUM(o."deliveryFee") FILTER (WHERE ${VALID}), 0)      AS "deliveryFees",
                  COALESCE(SUM(o."handlingFee") FILTER (WHERE ${VALID}), 0)      AS "handlingFees",
                  COALESCE(SUM(o.tip) FILTER (WHERE ${VALID}), 0)                AS "tips",
                  COALESCE(SUM(o."taxTotal") FILTER (WHERE ${VALID}), 0)         AS "tax",
                  COUNT(DISTINCT o."userId") FILTER (WHERE ${VALID})::int        AS "customers",
                  AVG(EXTRACT(EPOCH FROM (o."acceptedAt" - o."placedAt")) / 60)  AS "avgAcceptMinutes",
                  AVG(EXTRACT(EPOCH FROM (o."packedAt" - o."placedAt")) / 60)    AS "avgPackedMinutes",
                  AVG(EXTRACT(EPOCH FROM (o."deliveredAt" - o."placedAt")) / 60) AS "avgDeliveryMinutes",
                  AVG(o.rating)                                                  AS "avgRating",
                  COUNT(o.rating)::int                                           AS "ratings"
                FROM "Order" o
                WHERE ${where}`,
            this.prisma.$queryRaw<any[]>`
                SELECT COALESCE(SUM(oi.quantity), 0)::int AS "itemsSold",
                       COUNT(DISTINCT oi."variantId")::int AS "distinctProducts"
                FROM "OrderItem" oi JOIN "Order" o ON o.id = oi."orderId"
                WHERE ${where} AND ${VALID} AND oi."parentId" IS NULL`,
            // First-ever valid order at this store (or platform) inside the window = new customer.
            this.prisma.$queryRaw<any[]>`
                SELECT COUNT(*)::int AS "newCustomers" FROM (
                    SELECT o."userId", MIN(o."placedAt") AS first
                    FROM "Order" o
                    WHERE ${VALID} ${storeId == null ? Prisma.empty : Prisma.sql`AND o."storeId" = ${storeId}`}
                    GROUP BY o."userId"
                ) f
                WHERE f.first >= ${start} AND f.first < ${end}`,
        ]);

        const validOrders = o.validOrders as number;
        const gross = num(o.grossSales);
        return {
            orders: o.orders as number,
            validOrders,
            delivered: o.delivered as number,
            cancelled: o.cancelled as number,
            cancellationRate: o.orders ? round((o.cancelled / o.orders) * 100, 1)! : 0,
            grossSales: gross,
            itemSales: num(o.itemSales),
            discounts: num(o.discounts),
            netItemSales: num(o.itemSales) - num(o.discounts),
            deliveryFees: num(o.deliveryFees),
            handlingFees: num(o.handlingFees),
            tips: num(o.tips),
            tax: num(o.tax),
            aov: validOrders ? round(gross / validOrders)! : 0,
            itemsSold: items.itemsSold as number,
            itemsPerOrder: validOrders ? round(items.itemsSold / validOrders)! : 0,
            distinctProducts: items.distinctProducts as number,
            customers: o.customers as number,
            newCustomers: Math.min(cust.newCustomers as number, o.customers as number),
            returningCustomers: Math.max((o.customers as number) - (cust.newCustomers as number), 0),
            avgAcceptMinutes: round(o.avgAcceptMinutes, 1),
            avgPackedMinutes: round(o.avgPackedMinutes, 1),
            avgDeliveryMinutes: round(o.avgDeliveryMinutes, 1),
            avgRating: round(o.avgRating, 2),
            ratings: o.ratings as number,
        };
    }

    /** Money fields of a KPI set as MoneyView. */
    private presentKpis(k: Awaited<ReturnType<AnalyticsService["kpis"]>>) {
        const m = (v: number) => this.currency.format(v);
        return {
            ...k,
            grossSales: m(k.grossSales),
            itemSales: m(k.itemSales),
            discounts: m(k.discounts),
            netItemSales: m(k.netItemSales),
            deliveryFees: m(k.deliveryFees),
            handlingFees: m(k.handlingFees),
            tips: m(k.tips),
            tax: m(k.tax),
            aov: m(k.aov),
        };
    }

    async overview(storeId: bigint, q: OverviewInput) {
        const w = this.resolveWindow(q, await this.storeTz(storeId));
        const key = `analytics:overview:${storeId}:${w.from}:${w.to}:${q.paymentMethod ?? ""}:${q.source ?? ""}:${q.compare !== false}`;

        // Short cache: dashboards poll; numbers may lag by up to a minute.
        return this.redis.cachedLease(key, 60, async () => {
            const cur = await this.kpis(storeId, w.start, w.end, q);
            const result: Record<string, unknown> = {
                window: this.window(w),
                currency: this.currency.info,
                current: this.presentKpis(cur),
            };

            if (q.compare !== false) {
                const prev = await this.kpis(storeId, w.prev.start, w.prev.end, q);
                result.previous = {
                    window: { from: w.prev.from, to: w.prev.to },
                    ...this.presentKpis(prev),
                };
                result.change = Object.fromEntries(
                    (
                        [
                            "orders",
                            "validOrders",
                            "grossSales",
                            "netItemSales",
                            "aov",
                            "itemsSold",
                            "customers",
                            "newCustomers",
                            "cancellationRate",
                            "avgDeliveryMinutes",
                        ] as const
                    ).map((field) => [
                        field,
                        pctChange(Number(cur[field] ?? 0), Number(prev[field] ?? 0)),
                    ]),
                );
            }
            return result;
        });
    }

    // ---------------------------------------------------------------------
    // Time series
    // ---------------------------------------------------------------------

    async salesSeries(storeId: bigint, q: SalesSeriesInput) {
        const w = this.resolveWindow(q, await this.storeTz(storeId));
        const unit: Granularity =
            q.groupBy ?? (w.days <= 2 ? "hour" : w.days <= 92 ? "day" : "week");
        if (unit === "hour" && w.days > 31)
            throw new BadRequestException({
                message: this.i18n.translate("analytics.errors.tooManyBuckets"),
                code: "TOO_MANY_BUCKETS",
            });

        const local = this.local(w.tz);
        const fromLocal = `${w.from} 00:00:00`;
        const toLocal = `${w.to} 23:59:59`;
        const rows = await this.prisma.$queryRaw<any[]>`
            WITH buckets AS (
                SELECT generate_series(
                    date_trunc(${unit}, ${fromLocal}::timestamp),
                    date_trunc(${unit}, ${toLocal}::timestamp),
                    ${STEP[unit]}::interval
                ) AS bucket
            ),
            agg AS (
                SELECT date_trunc(${unit}, ${local}) AS bucket,
                       COUNT(*) FILTER (WHERE ${PLACED})::int            AS "orders",
                       COUNT(*) FILTER (WHERE ${VALID})::int             AS "validOrders",
                       COUNT(*) FILTER (WHERE ${CANCELLED})::int         AS "cancelled",
                       COALESCE(SUM(o.total) FILTER (WHERE ${VALID}), 0) AS "grossSales",
                       COUNT(DISTINCT o."userId") FILTER (WHERE ${VALID})::int AS "customers"
                FROM "Order" o
                WHERE ${this.scope(storeId, w.start, w.end, q)}
                GROUP BY 1
            ),
            items AS (
                SELECT date_trunc(${unit}, ${local}) AS bucket,
                       SUM(oi.quantity)::int AS "itemsSold"
                FROM "OrderItem" oi JOIN "Order" o ON o.id = oi."orderId"
                WHERE ${this.scope(storeId, w.start, w.end, q)} AND ${VALID} AND oi."parentId" IS NULL
                GROUP BY 1
            )
            SELECT b.bucket,
                   COALESCE(a."orders", 0)      AS "orders",
                   COALESCE(a."validOrders", 0) AS "validOrders",
                   COALESCE(a."cancelled", 0)   AS "cancelled",
                   COALESCE(a."grossSales", 0)  AS "grossSales",
                   COALESCE(a."customers", 0)   AS "customers",
                   COALESCE(i."itemsSold", 0)   AS "itemsSold"
            FROM buckets b
            LEFT JOIN agg a ON a.bucket = b.bucket
            LEFT JOIN items i ON i.bucket = b.bucket
            ORDER BY b.bucket`;

        const points = rows.map((r) => {
            const gross = num(r.grossSales);
            const valid = Number(r.validOrders);
            // bucket is a store-local wall time without zone: print it as such.
            const label = (r.bucket as Date).toISOString().replace("T", " ").slice(0, unit === "hour" ? 16 : 10);
            return {
                bucket: label,
                orders: Number(r.orders),
                validOrders: valid,
                cancelled: Number(r.cancelled),
                customers: Number(r.customers),
                itemsSold: Number(r.itemsSold),
                grossSales: this.currency.format(gross),
                aov: this.currency.format(valid ? gross / valid : 0),
            };
        });

        const best = points.reduce<(typeof points)[number] | null>(
            (top, p) => (!top || p.grossSales.amount > top.grossSales.amount ? p : top),
            null,
        );
        return {
            window: this.window(w),
            groupBy: unit,
            currency: this.currency.info,
            totals: {
                orders: points.reduce((s, p) => s + p.orders, 0),
                validOrders: points.reduce((s, p) => s + p.validOrders, 0),
                itemsSold: points.reduce((s, p) => s + p.itemsSold, 0),
                grossSales: this.currency.format(points.reduce((s, p) => s + p.grossSales.amount, 0)),
            },
            bestBucket: best && best.grossSales.amount > 0 ? best.bucket : null,
            points,
        };
    }

    // ---------------------------------------------------------------------
    // Breakdowns (EDA)
    // ---------------------------------------------------------------------

    async breakdown(storeId: bigint, q: BreakdownInput, lang?: string) {
        const w = this.resolveWindow(q, await this.storeTz(storeId));
        const by: Breakdown = q.by ?? "payment_method";
        const where = this.scope(storeId, w.start, w.end, q);
        const local = this.local(w.tz);

        let rows: { key: string; label: string; orders: number; revenue: number; quantity: number | null }[];

        if (by === "category" || by === "brand") {
            const join =
                by === "category"
                    ? Prisma.sql`LEFT JOIN "Category" g ON g.id = p."categoryId"`
                    : Prisma.sql`LEFT JOIN "Brand" g ON g.id = p."brandId"`;
            const raw = await this.prisma.$queryRaw<any[]>`
                SELECT g.id AS "key", g.name AS "name",
                       COUNT(DISTINCT o.id)::int AS "orders",
                       COALESCE(SUM(oi."lineTotal"), 0) AS "revenue",
                       COALESCE(SUM(oi.quantity), 0)::int AS "quantity"
                FROM "OrderItem" oi
                JOIN "Order" o ON o.id = oi."orderId"
                LEFT JOIN "Product" p ON p.id = oi."productId"
                ${join}
                WHERE ${where} AND ${VALID} AND oi."parentId" IS NULL
                GROUP BY g.id, g.name
                ORDER BY 4 DESC`;
            rows = raw.map((r) => ({
                key: r.key == null ? "none" : String(r.key),
                label: r.key == null ? "—" : this.locale.pick(r.name, lang),
                orders: r.orders,
                revenue: num(r.revenue),
                quantity: r.quantity,
            }));
        } else {
            const group =
                by === "payment_method"
                    ? Prisma.sql`o."paymentMethod"::text`
                    : by === "status"
                      ? Prisma.sql`o.status::text`
                      : by === "source"
                        ? Prisma.sql`o.source::text`
                        : by === "hour"
                          ? Prisma.sql`EXTRACT(HOUR FROM ${local})::int::text`
                          : Prisma.sql`EXTRACT(DOW FROM ${local})::int::text`;
            // "status" shows every placed order; other views count real sales only.
            const filter = by === "status" ? PLACED : VALID;
            const raw = await this.prisma.$queryRaw<any[]>`
                SELECT ${group} AS "key",
                       COUNT(*)::int AS "orders",
                       COALESCE(SUM(o.total), 0) AS "revenue"
                FROM "Order" o
                WHERE ${where} AND ${filter}
                GROUP BY 1`;
            const byKey = new Map(raw.map((r) => [String(r.key), r]));
            const keys =
                by === "hour"
                    ? Array.from({ length: 24 }, (_, h) => String(h))
                    : by === "weekday"
                      ? Array.from({ length: 7 }, (_, d) => String(d))
                      : [...byKey.keys()];
            rows = keys.map((key) => {
                const r = byKey.get(key);
                return {
                    key,
                    label:
                        by === "hour"
                            ? `${key.padStart(2, "0")}:00`
                            : by === "weekday"
                              ? WEEKDAYS[Number(key)]
                              : key,
                    orders: r ? Number(r.orders) : 0,
                    revenue: r ? num(r.revenue) : 0,
                    quantity: null,
                };
            });
            if (by !== "hour" && by !== "weekday") rows.sort((a, b) => b.revenue - a.revenue);
        }

        const totalOrders = rows.reduce((s, r) => s + r.orders, 0);
        const totalRevenue = rows.reduce((s, r) => s + r.revenue, 0);
        return {
            window: this.window(w),
            by,
            currency: this.currency.info,
            items: rows.map((r) => ({
                ...r,
                revenue: this.currency.format(r.revenue),
                orderShare: totalOrders ? round((r.orders / totalOrders) * 100, 1) : 0,
                revenueShare: totalRevenue ? round((r.revenue / totalRevenue) * 100, 1) : 0,
            })),
        };
    }

    /** Orders by weekday × hour (store-local) — when to staff up / run surges. */
    async heatmap(storeId: bigint, q: AnalyticsInput) {
        const w = this.resolveWindow(q, await this.storeTz(storeId));
        const local = this.local(w.tz);
        const raw = await this.prisma.$queryRaw<any[]>`
            SELECT EXTRACT(DOW FROM ${local})::int AS "dow",
                   EXTRACT(HOUR FROM ${local})::int AS "hour",
                   COUNT(*)::int AS "orders",
                   COALESCE(SUM(o.total), 0) AS "revenue"
            FROM "Order" o
            WHERE ${this.scope(storeId, w.start, w.end, q)} AND ${VALID}
            GROUP BY 1, 2`;

        const orders = Array.from({ length: 7 }, () => Array<number>(24).fill(0));
        const revenue = Array.from({ length: 7 }, () => Array<number>(24).fill(0));
        let peak = { weekday: "", hour: 0, orders: 0 };
        for (const r of raw) {
            orders[r.dow][r.hour] = r.orders;
            revenue[r.dow][r.hour] = round(num(r.revenue))!;
            if (r.orders > peak.orders)
                peak = { weekday: WEEKDAYS[r.dow], hour: r.hour, orders: r.orders };
        }
        return {
            window: this.window(w),
            currency: this.currency.info,
            weekdays: WEEKDAYS,
            hours: Array.from({ length: 24 }, (_, h) => h),
            /** orders[weekday][hour], weekday 0 = Sunday */
            orders,
            /** revenue[weekday][hour] as plain numbers in the store currency */
            revenue,
            peak: peak.orders ? peak : null,
        };
    }

    // ---------------------------------------------------------------------
    // Products
    // ---------------------------------------------------------------------

    /** Best (or worst) selling variants, joined with current stock. */
    async topProducts(storeId: bigint, q: ProductAnalyticsInput, lang?: string) {
        const w = this.resolveWindow(q, await this.storeTz(storeId));
        const sortCol =
            q.sort === "quantity" ? Prisma.raw(`"quantity"`) : q.sort === "orders" ? Prisma.raw(`"orders"`) : Prisma.raw(`"revenue"`);
        const dir = Prisma.raw(q.order === "asc" ? "ASC" : "DESC");

        const raw = await this.prisma.$queryRaw<any[]>`
            SELECT oi."variantId",
                   MAX(oi."productId") AS "productId",
                   MAX(oi.sku) AS "sku",
                   MAX(oi."variantLabel") AS "variantLabel",
                   (ARRAY_AGG(oi.title))[1] AS "title",
                   SUM(oi.quantity)::int AS "quantity",
                   COUNT(DISTINCT oi."orderId")::int AS "orders",
                   COALESCE(SUM(oi."lineTotal"), 0) AS "revenue",
                   COALESCE(SUM(oi."discountAmount"), 0) AS "discount",
                   AVG(oi."unitPrice") AS "avgPrice"
            FROM "OrderItem" oi
            JOIN "Order" o ON o.id = oi."orderId"
            ${q.categoryId ? Prisma.sql`JOIN "Product" p ON p.id = oi."productId"` : Prisma.empty}
            WHERE ${this.scope(storeId, w.start, w.end, q)} AND ${VALID}
              AND oi."parentId" IS NULL AND oi."variantId" IS NOT NULL
              ${q.categoryId ? Prisma.sql`AND p."categoryId" = ${BigInt(q.categoryId)}` : Prisma.empty}
            GROUP BY oi."variantId"
            ORDER BY ${sortCol} ${dir}, oi."variantId"
            LIMIT ${q.limit ?? 20}`;

        const listings = await this.prisma.storeProduct.findMany({
            where: { storeId, variantId: { in: raw.map((r) => BigInt(r.variantId)) } },
            select: {
                id: true,
                variantId: true,
                isActive: true,
                availableQty: true,
                reservedQty: true,
                lowStockThreshold: true,
                sellingPrice: true,
            },
        });
        const byVariant = new Map(listings.map((l) => [l.variantId.toString(), l]));
        const totalRevenue = raw.reduce((s, r) => s + num(r.revenue), 0);

        return {
            window: this.window(w),
            sort: q.sort ?? "revenue",
            order: q.order ?? "desc",
            currency: this.currency.info,
            items: raw.map((r, index) => {
                const l = byVariant.get(String(r.variantId));
                const sellable = l ? l.availableQty - l.reservedQty : null;
                const perDay = r.quantity / w.days;
                return {
                    rank: index + 1,
                    variantId: String(r.variantId),
                    productId: r.productId == null ? null : String(r.productId),
                    sku: r.sku,
                    title: this.locale.pick(r.title, lang),
                    variantLabel: r.variantLabel,
                    quantity: r.quantity,
                    orders: r.orders,
                    revenue: this.currency.format(r.revenue),
                    discount: this.currency.format(r.discount),
                    avgPrice: this.currency.format(r.avgPrice),
                    revenueShareOfTop: totalRevenue ? round((num(r.revenue) / totalRevenue) * 100, 1) : 0,
                    avgPerDay: round(perDay, 2),
                    stock: l
                        ? {
                              storeProductId: l.id.toString(),
                              isActive: l.isActive,
                              sellable,
                              lowStock: sellable! <= l.lowStockThreshold,
                              /** Days the current stock lasts at this window's sales speed. */
                              daysOfCover: perDay > 0 ? round(sellable! / perDay, 1) : null,
                              sellingPrice: this.currency.format(l.sellingPrice),
                          }
                        : null,
                };
            }),
        };
    }

    /** Listed, in-stock variants that sold little or nothing — candidates for promos / delisting. */
    async slowMovers(storeId: bigint, q: SlowMoversInput, lang?: string) {
        const w = this.resolveWindow(q, await this.storeTz(storeId));
        const raw = await this.prisma.$queryRaw<any[]>`
            SELECT sp.id, sp."variantId",
                   (sp."availableQty" - sp."reservedQty")::int AS "sellable",
                   sp."sellingPrice",
                   COALESCE(s.quantity, 0)::int AS "quantity",
                   COALESCE(s.revenue, 0) AS "revenue",
                   s."lastSoldAt"
            FROM "StoreProduct" sp
            LEFT JOIN (
                SELECT oi."variantId", SUM(oi.quantity) AS quantity, SUM(oi."lineTotal") AS revenue,
                       MAX(o."placedAt") AS "lastSoldAt"
                FROM "OrderItem" oi JOIN "Order" o ON o.id = oi."orderId"
                WHERE ${this.scope(storeId, w.start, w.end, q)} AND ${VALID} AND oi."parentId" IS NULL
                GROUP BY oi."variantId"
            ) s ON s."variantId" = sp."variantId"
            WHERE sp."storeId" = ${storeId} AND sp."isActive" = true
              AND sp."availableQty" - sp."reservedQty" > 0
            ORDER BY COALESCE(s.quantity, 0) ASC, (sp."availableQty" - sp."reservedQty") * sp."sellingPrice" DESC
            LIMIT ${q.limit ?? 20}`;

        const details = await this.prisma.storeProduct.findMany({
            where: { id: { in: raw.map((r) => BigInt(r.id)) } },
            select: {
                id: true,
                productId: true,
                variant: { select: { sku: true } },
                product: { select: { translations: { select: { lang: true, title: true } } } },
            },
        });
        const byId = new Map(details.map((d) => [d.id.toString(), d]));

        return {
            window: this.window(w),
            currency: this.currency.info,
            items: raw.map((r) => {
                const d = byId.get(String(r.id));
                const perDay = r.quantity / w.days;
                return {
                    storeProductId: String(r.id),
                    variantId: String(r.variantId),
                    productId: d?.productId.toString() ?? null,
                    sku: d?.variant.sku ?? null,
                    title: d
                        ? this.locale.pick(
                              Object.fromEntries(d.product.translations.map((t) => [t.lang, t.title])),
                              lang,
                          )
                        : null,
                    sellable: r.sellable,
                    stockValue: this.currency.format(r.sellable * num(r.sellingPrice)),
                    quantitySold: r.quantity,
                    revenue: this.currency.format(r.revenue),
                    lastSoldAt: r.lastSoldAt,
                    daysOfCover: perDay > 0 ? round(r.sellable / perDay, 1) : null,
                };
            }),
        };
    }

    // ---------------------------------------------------------------------
    // Customers
    // ---------------------------------------------------------------------

    async customers(storeId: bigint, q: CustomerAnalyticsInput) {
        const w = this.resolveWindow(q, await this.storeTz(storeId));
        const where = this.scope(storeId, w.start, w.end, q);

        const [perCustomer, k] = await Promise.all([
            this.prisma.$queryRaw<any[]>`
                SELECT o."userId", COUNT(*)::int AS "orders", COALESCE(SUM(o.total), 0) AS "spend",
                       MAX(o."placedAt") AS "lastOrderAt"
                FROM "Order" o
                WHERE ${where} AND ${VALID}
                GROUP BY o."userId"
                ORDER BY 3 DESC`,
            this.kpis(storeId, w.start, w.end, q),
        ]);

        const buckets = { "1": 0, "2": 0, "3-5": 0, "6+": 0 };
        for (const c of perCustomer) {
            const n = c.orders as number;
            buckets[n === 1 ? "1" : n === 2 ? "2" : n <= 5 ? "3-5" : "6+"]++;
        }

        const top = perCustomer.slice(0, q.top ?? 10);
        const users = await this.prisma.user.findMany({
            where: { id: { in: top.map((c) => BigInt(c.userId)) } },
            select: { id: true, name: true, phone: true },
        });
        const userById = new Map(users.map((u) => [u.id.toString(), u]));
        const totalSpend = perCustomer.reduce((s, c) => s + num(c.spend), 0);

        return {
            window: this.window(w),
            currency: this.currency.info,
            customers: k.customers,
            newCustomers: k.newCustomers,
            returningCustomers: k.returningCustomers,
            repeatRate: k.customers ? round((perCustomer.filter((c) => c.orders > 1).length / k.customers) * 100, 1) : 0,
            avgOrdersPerCustomer: k.customers ? round(k.validOrders / k.customers) : 0,
            avgSpendPerCustomer: this.currency.format(k.customers ? totalSpend / k.customers : 0),
            orderFrequency: buckets,
            top: top.map((c) => {
                const u = userById.get(String(c.userId));
                return {
                    userId: String(c.userId),
                    name: u?.name ?? null,
                    phone: u ? maskPhone(u.phone) : null,
                    orders: c.orders,
                    spend: this.currency.format(c.spend),
                    lastOrderAt: c.lastOrderAt,
                };
            }),
        };
    }

    // ---------------------------------------------------------------------
    // Admin: compare stores
    // ---------------------------------------------------------------------

    async storeLeaderboard(q: StoreLeaderboardInput, lang?: string) {
        const w = this.resolveWindow(q, this.defaultTz);
        const raw = await this.prisma.$queryRaw<any[]>`
            SELECT o."storeId",
                   COUNT(*) FILTER (WHERE ${PLACED})::int AS "orders",
                   COUNT(*) FILTER (WHERE ${VALID})::int AS "validOrders",
                   COUNT(*) FILTER (WHERE ${CANCELLED})::int AS "cancelled",
                   COALESCE(SUM(o.total) FILTER (WHERE ${VALID}), 0) AS "grossSales",
                   COUNT(DISTINCT o."userId") FILTER (WHERE ${VALID})::int AS "customers",
                   AVG(EXTRACT(EPOCH FROM (o."deliveredAt" - o."placedAt")) / 60) AS "avgDeliveryMinutes",
                   AVG(o.rating) AS "avgRating"
            FROM "Order" o
            WHERE ${this.scope(null, w.start, w.end, q)}
            GROUP BY o."storeId"`;

        const stores = await this.prisma.store.findMany({
            select: { id: true, code: true, name: true, city: true, status: true },
        });
        const statsById = new Map(raw.map((r) => [String(r.storeId), r]));

        const rows = stores.map((s) => {
            const r = statsById.get(s.id.toString());
            const valid = r?.validOrders ?? 0;
            const gross = num(r?.grossSales);
            const orders = r?.orders ?? 0;
            return {
                storeId: s.id.toString(),
                code: s.code,
                name: this.locale.pick(s.name, lang),
                city: s.city,
                status: s.status,
                orders,
                validOrders: valid,
                cancelled: r?.cancelled ?? 0,
                cancellationRate: orders ? round(((r?.cancelled ?? 0) / orders) * 100, 1)! : 0,
                grossSales: gross,
                aov: valid ? round(gross / valid)! : 0,
                customers: r?.customers ?? 0,
                avgDeliveryMinutes: round(r?.avgDeliveryMinutes, 1),
                avgRating: round(r?.avgRating, 2),
            };
        });

        const sort = q.sort ?? "grossSales";
        rows.sort((a, b) => (sort === "cancellationRate" ? a[sort] - b[sort] : b[sort] - a[sort]));
        const total = rows.reduce((s, r) => s + r.grossSales, 0);

        return {
            window: this.window(w),
            sort,
            currency: this.currency.info,
            totals: {
                orders: rows.reduce((s, r) => s + r.orders, 0),
                grossSales: this.currency.format(total),
            },
            items: rows.map((r, index) => ({
                rank: index + 1,
                ...r,
                grossSales: this.currency.format(r.grossSales),
                aov: this.currency.format(r.aov),
                salesShare: total ? round((r.grossSales / total) * 100, 1) : 0,
            })),
        };
    }
}
