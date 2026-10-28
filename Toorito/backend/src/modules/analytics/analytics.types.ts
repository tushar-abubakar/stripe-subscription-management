import { OrderSource, PaymentMethod } from "@prisma-client/enums";

/** Plain input types of the analytics services (no decorators; the HTTP DTOs in src/api implement them). */


export const PERIODS = [
    "today",
    "yesterday",
    "last_7_days",
    "last_30_days",
    "this_week",
    "last_week",
    "this_month",
    "last_month",
    "custom",
] as const;

export type Period = (typeof PERIODS)[number];

export const GRANULARITIES = ["hour", "day", "week", "month"] as const;

export type Granularity = (typeof GRANULARITIES)[number];

export const BREAKDOWNS = [
    "payment_method",
    "status",
    "source",
    "hour",
    "weekday",
    "category",
    "brand",
] as const;

export type Breakdown = (typeof BREAKDOWNS)[number];

/**
 * Time window + filters shared by every analytics endpoint.
 * Dates are calendar days in the store's timezone (admin cross-store
 * reports use the platform timezone).
 */
export interface AnalyticsInput {
    period?: Period;
    from?: string;
    to?: string;
    paymentMethod?: PaymentMethod;
    source?: OrderSource;
}

export interface OverviewInput extends AnalyticsInput {
    compare?: boolean;
}

export interface SalesSeriesInput extends AnalyticsInput {
    groupBy?: Granularity;
}

export interface BreakdownInput extends AnalyticsInput {
    by?: Breakdown;
}

export interface ProductAnalyticsInput extends AnalyticsInput {
    sort?: "revenue" | "quantity" | "orders";
    order?: "desc" | "asc";
    categoryId?: number;
    limit?: number;
}

export interface SlowMoversInput extends AnalyticsInput {
    limit?: number;
}

export interface CustomerAnalyticsInput extends AnalyticsInput {
    top?: number;
}

export interface StoreLeaderboardInput extends AnalyticsInput {
    sort?: "grossSales" | "orders" | "aov" | "cancellationRate";
}
