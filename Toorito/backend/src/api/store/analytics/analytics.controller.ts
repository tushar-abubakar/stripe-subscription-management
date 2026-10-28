import { P } from "@common/authorization/permissions";
import { StoreScopeService } from "@common/authorization/store-scope.service";
import { CurrentUser, Permissions } from "@common/decorators/auth.decorator";
import { AuthUser } from "@common/types/auth.type";
import {
    AnalyticsQuery,
    BreakdownQuery,
    CustomerAnalyticsQuery,
    OverviewQuery,
    ProductAnalyticsQuery,
    SalesSeriesQuery,
    SlowMoversQuery,
} from "./analytics.dto";
import { AnalyticsService } from "@modules/analytics/analytics.service";
import {
    ApiAnalyticsBreakdown,
    ApiAnalyticsCustomers,
    ApiAnalyticsHeatmap,
    ApiAnalyticsOverview,
    ApiAnalyticsSales,
    ApiAnalyticsSlowMovers,
    ApiAnalyticsTopProducts,
} from "./analytics.swagger";
import { Get, Query } from "@nestjs/common";
import { I18nLang } from "nestjs-i18n";
import { StoreController } from "../store-controller.decorator";

/** Store manager: sales reports of their own store. */
@Permissions(P.ANALYTICS_READ)
@StoreController("analytics", "Analytics", {
    managerOnly: true,
    forbidden:
        "Not STORE_MANAGER, `analytics.read` missing or no store assigned",
})
export class StoreAnalyticsController {
    constructor(
        private readonly analytics: AnalyticsService,
        private readonly storeScope: StoreScopeService,
    ) {}

    @ApiAnalyticsOverview()
    @Get("overview")
    overview(@CurrentUser() u: AuthUser, @Query() q: OverviewQuery) {
        return this.analytics.overview(this.storeScope.scope(u), q);
    }

    @ApiAnalyticsSales()
    @Get("sales")
    sales(@CurrentUser() u: AuthUser, @Query() q: SalesSeriesQuery) {
        return this.analytics.salesSeries(this.storeScope.scope(u), q);
    }

    @ApiAnalyticsBreakdown()
    @Get("breakdown")
    breakdown(
        @CurrentUser() u: AuthUser,
        @Query() q: BreakdownQuery,
        @I18nLang() lang: string,
    ) {
        return this.analytics.breakdown(this.storeScope.scope(u), q, lang);
    }

    @ApiAnalyticsHeatmap()
    @Get("heatmap")
    heatmap(@CurrentUser() u: AuthUser, @Query() q: AnalyticsQuery) {
        return this.analytics.heatmap(this.storeScope.scope(u), q);
    }

    @ApiAnalyticsTopProducts()
    @Get("products/top")
    topProducts(
        @CurrentUser() u: AuthUser,
        @Query() q: ProductAnalyticsQuery,
        @I18nLang() lang: string,
    ) {
        return this.analytics.topProducts(this.storeScope.scope(u), q, lang);
    }

    @ApiAnalyticsSlowMovers()
    @Get("products/slow-moving")
    slowMovers(
        @CurrentUser() u: AuthUser,
        @Query() q: SlowMoversQuery,
        @I18nLang() lang: string,
    ) {
        return this.analytics.slowMovers(this.storeScope.scope(u), q, lang);
    }

    @ApiAnalyticsCustomers()
    @Get("customers")
    customers(@CurrentUser() u: AuthUser, @Query() q: CustomerAnalyticsQuery) {
        return this.analytics.customers(this.storeScope.scope(u), q);
    }
}
