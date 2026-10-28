/**
 * Swagger / OpenAPI documentation for store sales analytics.
 * Money is a MoneyView `{ amount, currency, symbol, formatted }`.
 * "Sales" = orders not in PENDING_PAYMENT / CANCELLED / REJECTED / FAILED.
 */
import { applyDecorators } from "@nestjs/common";
import {
    ApiBadRequestResponse,
    ApiBearerAuth,
    ApiForbiddenResponse,
    ApiHeader,
    ApiNotFoundResponse,
    ApiOkResponse,
    ApiOperation,
    ApiParam,
    ApiTags,
    ApiUnauthorizedResponse,
} from "@nestjs/swagger";

function errorSchema(statusCode: number, error: string, message: string | string[], code?: string) {
    return {
        type: "object",
        properties: {
            statusCode: { type: "number", example: statusCode },
            message: { oneOf: [{ type: "string" }, { type: "array", items: { type: "string" } }], example: message },
            error: { type: "string", example: error },
            ...(code && { code: { type: "string", example: code } }),
        },
    };
}

const money = (amount: number) => ({ amount, currency: "BDT", symbol: "৳", formatted: `৳${amount.toLocaleString("en", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` });
const CURRENCY = { code: "BDT", symbol: "৳" };
const WINDOW = { from: "2026-10-14", to: "2026-10-20", days: 7, timezone: "Asia/Dhaka" };

const WINDOW_ERRORS = ApiBadRequestResponse({
    description:
        "Invalid window: `from` after `to` (FROM_AFTER_TO), longer than 366 days (RANGE_TOO_LONG), hourly buckets over 31 days " +
        "(TOO_MANY_BUCKETS) or query validation",
    schema: errorSchema(400, "Bad Request", "The start date must be on or before the end date", "FROM_AFTER_TO"),
});

const COMMON_QUERY_DOC =
    "Window: `period` = today | yesterday | last_7_days (default) | last_30_days | this_week | last_week | this_month | last_month, " +
    "or `from` / `to` (store-local days, inclusive). Filters: `paymentMethod`, `source`.";

export const ApiStoreAnalyticsController = () =>
    applyDecorators(
        ApiTags("StoreAnalytics"),
        ApiBearerAuth(),
        ApiHeader({ name: "Accept-Language", required: false, example: "en", description: "Language of product / category names" }),
        ApiUnauthorizedResponse({ description: "Missing / invalid token", schema: errorSchema(401, "Unauthorized", "Unauthorized") }),
        ApiForbiddenResponse({ description: "Not STORE_MANAGER, `analytics.read` missing or no store assigned", schema: errorSchema(403, "Forbidden", "Forbidden resource") }),
    );

export const ApiAdminAnalyticsController = () =>
    applyDecorators(
        ApiTags("AdminAnalytics"),
        ApiBearerAuth(),
        ApiHeader({ name: "Accept-Language", required: false, example: "en" }),
        ApiUnauthorizedResponse({ description: "Missing / invalid token", schema: errorSchema(401, "Unauthorized", "Unauthorized") }),
        ApiForbiddenResponse({ description: "Not ADMIN / SUPER_ADMIN or `analytics.read` missing", schema: errorSchema(403, "Forbidden", "Forbidden resource") }),
    );

export const ApiAnalyticsStoreParam = () =>
    applyDecorators(
        ApiParam({ name: "storeId", description: "Store ID (bigint as numeric string)", schema: { type: "string", pattern: "^\\d+$" }, example: "7" }),
        ApiNotFoundResponse({ description: "Store not found", schema: errorSchema(404, "Not Found", "Store not found") }),
    );

const KPIS = {
    orders: 412, validOrders: 398, delivered: 390, cancelled: 14, cancellationRate: 3.4,
    grossSales: money(248930), itemSales: money(231400), discounts: money(9850), netItemSales: money(221550),
    deliveryFees: money(6120), handlingFees: money(9870), tips: money(1390), tax: money(11020), aov: money(625.45),
    itemsSold: 2311, itemsPerOrder: 5.81, distinctProducts: 486, customers: 301, newCustomers: 72, returningCustomers: 229,
    avgAcceptMinutes: 0.6, avgPackedMinutes: 4.8, avgDeliveryMinutes: 17.9, avgRating: 4.62, ratings: 140,
};

export const ApiAnalyticsOverview = () =>
    applyDecorators(
        ApiOperation({
            summary: "Sales KPIs with previous-period comparison",
            description:
                `Requires \`analytics.read\`. ${COMMON_QUERY_DOC} Gross sales = order totals of valid orders; net item sales = item ` +
                "subtotal − discounts. New customer = first valid order at this store inside the window. Times are minutes from placing. " +
                "With `compare` (default) the previous window of the same length is returned with % change (null when the base is 0). Cached 60 s.",
        }),
        ApiOkResponse({
            description: "KPIs",
            schema: {
                example: {
                    window: WINDOW,
                    currency: CURRENCY,
                    current: KPIS,
                    previous: { window: { from: "2026-10-07", to: "2026-10-13" }, ...KPIS, orders: 380, grossSales: money(221004) },
                    change: { orders: 8.4, validOrders: 7.9, grossSales: 12.6, netItemSales: 11.2, aov: 3.1, itemsSold: 9.7, customers: 6.2, newCustomers: 20, cancellationRate: -15, avgDeliveryMinutes: -4.3 },
                },
            },
        }),
        WINDOW_ERRORS,
    );

export const ApiAnalyticsSales = () =>
    applyDecorators(
        ApiOperation({
            summary: "Sales over time (hourly / daily / weekly / monthly)",
            description:
                `Requires \`analytics.read\`. ${COMMON_QUERY_DOC} \`groupBy\` = hour | day | week | month (default by window length). ` +
                "Buckets are store-local and gap-filled with zeros, ready for charts. Use `period=today&groupBy=hour` for the live day, " +
                "`period=last_30_days` for daily, `period=custom&from=…&groupBy=week|month` for longer trends.",
        }),
        ApiOkResponse({
            description: "Series",
            schema: {
                example: {
                    window: WINDOW,
                    groupBy: "day",
                    currency: CURRENCY,
                    totals: { orders: 412, validOrders: 398, itemsSold: 2311, grossSales: money(248930) },
                    bestBucket: "2026-10-18",
                    points: [
                        { bucket: "2026-10-14", orders: 51, validOrders: 50, cancelled: 1, customers: 47, itemsSold: 290, grossSales: money(30120), aov: money(602.4) },
                        { bucket: "2026-10-15", orders: 0, validOrders: 0, cancelled: 0, customers: 0, itemsSold: 0, grossSales: money(0), aov: money(0) },
                    ],
                },
            },
        }),
        WINDOW_ERRORS,
    );

export const ApiAnalyticsBreakdown = () =>
    applyDecorators(
        ApiOperation({
            summary: "Sales split by a dimension (EDA)",
            description:
                `Requires \`analytics.read\`. ${COMMON_QUERY_DOC} \`by\` = payment_method | status | source | hour (0-23, store-local) | ` +
                "weekday (0 = Sun) | category | brand. Category / brand use item line totals and also return quantity. `status` counts every " +
                "placed order (incl. cancelled); others only valid sales. Each row has its share of orders and revenue.",
        }),
        ApiOkResponse({
            description: "Breakdown",
            schema: {
                example: {
                    window: WINDOW,
                    by: "payment_method",
                    currency: CURRENCY,
                    items: [
                        { key: "UPI", label: "UPI", orders: 210, revenue: money(134200), quantity: null, orderShare: 52.8, revenueShare: 53.9 },
                        { key: "COD", label: "COD", orders: 140, revenue: money(80110), quantity: null, orderShare: 35.2, revenueShare: 32.2 },
                        { key: "CARD", label: "CARD", orders: 48, revenue: money(34620), quantity: null, orderShare: 12.1, revenueShare: 13.9 },
                    ],
                },
            },
        }),
        WINDOW_ERRORS,
    );

export const ApiAnalyticsHeatmap = () =>
    applyDecorators(
        ApiOperation({
            summary: "Orders heatmap — weekday × hour",
            description: `Requires \`analytics.read\`. ${COMMON_QUERY_DOC} \`orders[weekday][hour]\` (weekday 0 = Sunday, store-local). Use it to plan staff shifts and peak surges.`,
        }),
        ApiOkResponse({
            description: "Heatmap",
            schema: {
                example: {
                    window: WINDOW,
                    currency: CURRENCY,
                    weekdays: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
                    hours: [0, 1, 2, "…", 23],
                    orders: [[0, 0, 1, "… 24 values"], "… 7 rows"],
                    revenue: [[0, 0, 540.5, "… 24 values"], "… 7 rows"],
                    peak: { weekday: "Fri", hour: 20, orders: 31 },
                },
            },
        }),
        WINDOW_ERRORS,
    );

export const ApiAnalyticsTopProducts = () =>
    applyDecorators(
        ApiOperation({
            summary: "Best / worst selling products",
            description:
                `Requires \`analytics.read\`. ${COMMON_QUERY_DOC} Per variant: quantity, orders, revenue, discount, average price, ` +
                "sales per day and current stock with days of cover (how long the stock lasts at this speed). `sort` = revenue | quantity | orders, " +
                "`order=asc` for the weakest sellers, `categoryId` to focus one category.",
        }),
        ApiOkResponse({
            description: "Ranking",
            schema: {
                example: {
                    window: WINDOW, sort: "revenue", order: "desc", currency: CURRENCY,
                    items: [
                        {
                            rank: 1, variantId: "1201", productId: "345", sku: "AMUL-TAAZA-500", title: "Amul Taaza Toned Milk", variantLabel: "500 ml",
                            quantity: 640, orders: 402, revenue: money(33280), discount: money(0), avgPrice: money(52), revenueShareOfTop: 14.2,
                            avgPerDay: 91.43, stock: { storeProductId: "88", isActive: true, sellable: 120, lowStock: false, daysOfCover: 1.3, sellingPrice: money(52) },
                        },
                    ],
                },
            },
        }),
        WINDOW_ERRORS,
    );

export const ApiAnalyticsSlowMovers = () =>
    applyDecorators(
        ApiOperation({
            summary: "Slow-moving stock",
            description:
                `Requires \`analytics.read\`. ${COMMON_QUERY_DOC} Active, in-stock listings ordered by units sold (fewest first), then by ` +
                "stock value tied up. Candidates for discounts, clearance or delisting.",
        }),
        ApiOkResponse({
            description: "Slow movers",
            schema: {
                example: {
                    window: WINDOW, currency: CURRENCY,
                    items: [
                        {
                            storeProductId: "140", variantId: "2210", productId: "780", sku: "OLIVE-OIL-1L", title: "Extra Virgin Olive Oil", sellable: 24,
                            stockValue: money(26400), quantitySold: 0, revenue: money(0), lastSoldAt: null, daysOfCover: null,
                        },
                    ],
                },
            },
        }),
        WINDOW_ERRORS,
    );

export const ApiAnalyticsCustomers = () =>
    applyDecorators(
        ApiOperation({
            summary: "Customer analytics",
            description:
                `Requires \`analytics.read\`. ${COMMON_QUERY_DOC} New vs returning customers, repeat rate (customers with 2+ orders in the ` +
                "window), order frequency distribution and the top spenders (phone masked).",
        }),
        ApiOkResponse({
            description: "Customers",
            schema: {
                example: {
                    window: WINDOW, currency: CURRENCY, customers: 301, newCustomers: 72, returningCustomers: 229, repeatRate: 22.6,
                    avgOrdersPerCustomer: 1.32, avgSpendPerCustomer: money(827.01),
                    orderFrequency: { "1": 233, "2": 49, "3-5": 17, "6+": 2 },
                    top: [{ userId: "5012", name: "Ayesha", phone: "+880*******333", orders: 7, spend: money(6120), lastOrderAt: "2026-10-20T06:30:00.000Z" }],
                },
            },
        }),
        WINDOW_ERRORS,
    );

export const ApiAdminStoreLeaderboard = () =>
    applyDecorators(
        ApiOperation({
            summary: "Compare all stores",
            description:
                `Requires \`analytics.read\`. ${COMMON_QUERY_DOC} Days use the platform timezone. One row per store (stores without orders ` +
                "included with zeros): orders, cancellations, gross sales, AOV, customers, delivery time, rating and share of total sales. " +
                "`sort` = grossSales (default) | orders | aov | cancellationRate (lowest first).",
        }),
        ApiOkResponse({
            description: "Leaderboard",
            schema: {
                example: {
                    window: WINDOW, sort: "grossSales", currency: CURRENCY,
                    totals: { orders: 2950, grossSales: money(1810400) },
                    items: [
                        {
                            rank: 1, storeId: "7", code: "DS-DHK-GLS01", name: "Gulshan Hub Dark Store", city: "Dhaka", status: "ACTIVE",
                            orders: 412, validOrders: 398, cancelled: 14, cancellationRate: 3.4, grossSales: money(248930), aov: money(625.45),
                            customers: 301, avgDeliveryMinutes: 17.9, avgRating: 4.62, salesShare: 13.7,
                        },
                    ],
                },
            },
        }),
        WINDOW_ERRORS,
    );
