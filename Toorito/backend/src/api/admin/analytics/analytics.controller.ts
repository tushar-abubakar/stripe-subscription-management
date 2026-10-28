import { P } from "@common/authorization/permissions";
import { Permissions } from "@common/decorators/auth.decorator";
import { ParseBigIntPipe } from "@core/http/pipes/parse-bigint.pipe";
import {
    AnalyticsQuery,
    BreakdownQuery,
    CustomerAnalyticsQuery,
    OverviewQuery,
    ProductAnalyticsQuery,
    SalesSeriesQuery,
    SlowMoversQuery,
    StoreLeaderboardQuery,
} from "../../store/analytics/analytics.dto";
import { AnalyticsService } from "@modules/analytics/analytics.service";
import {
    ApiAdminStoreLeaderboard,
    ApiAnalyticsBreakdown,
    ApiAnalyticsCustomers,
    ApiAnalyticsHeatmap,
    ApiAnalyticsOverview,
    ApiAnalyticsSales,
    ApiAnalyticsSlowMovers,
    ApiAnalyticsStoreParam,
    ApiAnalyticsTopProducts,
} from "../../store/analytics/analytics.swagger";
import { Get, Param, Query } from "@nestjs/common";
import { I18nLang } from "nestjs-i18n";
import { AdminController } from "../admin-controller.decorator";

/** Admin: compare stores, or open any store's reports via `:storeId`. */
@Permissions(P.ANALYTICS_READ)
@AdminController(
    "",
    "Analytics",
    "Not ADMIN / SUPER_ADMIN or `analytics.read` missing",
)
export class AdminAnalyticsController {
    constructor(private readonly analytics: AnalyticsService) {}

    @ApiAdminStoreLeaderboard()
    @Get("analytics/stores")
    leaderboard(@Query() q: StoreLeaderboardQuery, @I18nLang() lang: string) {
        return this.analytics.storeLeaderboard(q, lang);
    }

    @ApiAnalyticsStoreParam()
    @ApiAnalyticsOverview()
    @Get("stores/:storeId/analytics/overview")
    overview(
        @Param("storeId", ParseBigIntPipe) storeId: bigint,
        @Query() q: OverviewQuery,
    ) {
        return this.analytics.overview(storeId, q);
    }

    @ApiAnalyticsStoreParam()
    @ApiAnalyticsSales()
    @Get("stores/:storeId/analytics/sales")
    sales(
        @Param("storeId", ParseBigIntPipe) storeId: bigint,
        @Query() q: SalesSeriesQuery,
    ) {
        return this.analytics.salesSeries(storeId, q);
    }

    @ApiAnalyticsStoreParam()
    @ApiAnalyticsBreakdown()
    @Get("stores/:storeId/analytics/breakdown")
    breakdown(
        @Param("storeId", ParseBigIntPipe) storeId: bigint,
        @Query() q: BreakdownQuery,
        @I18nLang() lang: string,
    ) {
        return this.analytics.breakdown(storeId, q, lang);
    }

    @ApiAnalyticsStoreParam()
    @ApiAnalyticsHeatmap()
    @Get("stores/:storeId/analytics/heatmap")
    heatmap(
        @Param("storeId", ParseBigIntPipe) storeId: bigint,
        @Query() q: AnalyticsQuery,
    ) {
        return this.analytics.heatmap(storeId, q);
    }

    @ApiAnalyticsStoreParam()
    @ApiAnalyticsTopProducts()
    @Get("stores/:storeId/analytics/products/top")
    topProducts(
        @Param("storeId", ParseBigIntPipe) storeId: bigint,
        @Query() q: ProductAnalyticsQuery,
        @I18nLang() lang: string,
    ) {
        return this.analytics.topProducts(storeId, q, lang);
    }

    @ApiAnalyticsStoreParam()
    @ApiAnalyticsSlowMovers()
    @Get("stores/:storeId/analytics/products/slow-moving")
    slowMovers(
        @Param("storeId", ParseBigIntPipe) storeId: bigint,
        @Query() q: SlowMoversQuery,
        @I18nLang() lang: string,
    ) {
        return this.analytics.slowMovers(storeId, q, lang);
    }

    @ApiAnalyticsStoreParam()
    @ApiAnalyticsCustomers()
    @Get("stores/:storeId/analytics/customers")
    customers(
        @Param("storeId", ParseBigIntPipe) storeId: bigint,
        @Query() q: CustomerAnalyticsQuery,
    ) {
        return this.analytics.customers(storeId, q);
    }
}
