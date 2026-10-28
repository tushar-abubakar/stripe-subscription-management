import {
    PERIODS,
    Period,
    GRANULARITIES,
    Granularity,
    BREAKDOWNS,
    Breakdown,
    AnalyticsInput,
    OverviewInput,
    SalesSeriesInput,
    BreakdownInput,
    ProductAnalyticsInput,
    SlowMoversInput,
    CustomerAnalyticsInput,
    StoreLeaderboardInput,
} from "@modules/analytics/analytics.types";
import { ApiPropertyOptional } from "@nestjs/swagger";
import { OrderSource, PaymentMethod } from "@prisma-client/enums";
import { Transform, Type } from "class-transformer";
import {
    IsBoolean,
    IsDateString,
    IsEnum,
    IsIn,
    IsInt,
    IsOptional,
    Max,
    Min,
} from "class-validator";

const QueryBool = () =>
    Transform(({ value }) =>
        value === "true" || value === "1" || value === true
            ? true
            : value === "false" || value === "0" || value === false
              ? false
              : value,
    );

/**
 * Time window + filters shared by every analytics endpoint.
 * Dates are calendar days in the store's timezone (admin cross-store
 * reports use the platform timezone).
 */
export class AnalyticsQuery implements AnalyticsInput {
    @ApiPropertyOptional({
        enum: PERIODS,
        default: "last_7_days",
        description: "Preset window. `custom` (or sending `from`) uses `from` / `to`. Weeks start on Monday.",
    })
    @IsOptional()
    @IsIn(PERIODS)
    period?: Period;

    @ApiPropertyOptional({ example: "2026-10-01", format: "date", description: "First day (store-local). Implies `period=custom`." })
    @IsOptional()
    @IsDateString()
    from?: string;

    @ApiPropertyOptional({ example: "2026-10-20", format: "date", description: "Last day, inclusive (default: today)" })
    @IsOptional()
    @IsDateString()
    to?: string;

    @ApiPropertyOptional({ enum: PaymentMethod, description: "Only orders paid this way" })
    @IsOptional()
    @IsEnum(PaymentMethod)
    paymentMethod?: PaymentMethod;

    @ApiPropertyOptional({ enum: OrderSource, description: "Only orders from this channel" })
    @IsOptional()
    @IsEnum(OrderSource)
    source?: OrderSource;
}

export class OverviewQuery extends AnalyticsQuery implements OverviewInput {
    @ApiPropertyOptional({ type: Boolean, default: true, description: "Also compute the previous window of the same length and % change" })
    @IsOptional()
    @QueryBool()
    @IsBoolean()
    compare?: boolean;
}

export class SalesSeriesQuery extends AnalyticsQuery implements SalesSeriesInput {
    @ApiPropertyOptional({
        enum: GRANULARITIES,
        description: "Bucket size. Default: hour for 1-2 day windows, day up to 92 days, else week. Empty buckets are returned as zeros.",
    })
    @IsOptional()
    @IsIn(GRANULARITIES)
    groupBy?: Granularity;
}

export class BreakdownQuery extends AnalyticsQuery implements BreakdownInput {
    @ApiPropertyOptional({ enum: BREAKDOWNS, default: "payment_method" })
    @IsOptional()
    @IsIn(BREAKDOWNS)
    by?: Breakdown;
}

export class ProductAnalyticsQuery extends AnalyticsQuery implements ProductAnalyticsInput {
    @ApiPropertyOptional({ enum: ["revenue", "quantity", "orders"], default: "revenue" })
    @IsOptional()
    @IsIn(["revenue", "quantity", "orders"])
    sort?: "revenue" | "quantity" | "orders";

    @ApiPropertyOptional({ enum: ["desc", "asc"], default: "desc", description: "desc = best sellers, asc = worst sellers (among those sold)" })
    @IsOptional()
    @IsIn(["desc", "asc"])
    order?: "desc" | "asc";

    @ApiPropertyOptional({ type: Number, example: 12 })
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    categoryId?: number;

    @ApiPropertyOptional({ type: Number, default: 20, minimum: 1, maximum: 100 })
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    @Max(100)
    limit?: number;
}

export class SlowMoversQuery extends AnalyticsQuery implements SlowMoversInput {
    @ApiPropertyOptional({ type: Number, default: 20, minimum: 1, maximum: 100 })
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    @Max(100)
    limit?: number;
}

export class CustomerAnalyticsQuery extends AnalyticsQuery implements CustomerAnalyticsInput {
    @ApiPropertyOptional({ type: Number, default: 10, minimum: 1, maximum: 50, description: "Size of the top-customers list" })
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    @Max(50)
    top?: number;
}

export class StoreLeaderboardQuery extends AnalyticsQuery implements StoreLeaderboardInput {
    @ApiPropertyOptional({ enum: ["grossSales", "orders", "aov", "cancellationRate"], default: "grossSales" })
    @IsOptional()
    @IsIn(["grossSales", "orders", "aov", "cancellationRate"])
    sort?: "grossSales" | "orders" | "aov" | "cancellationRate";
}
