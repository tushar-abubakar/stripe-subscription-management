import { P } from "@common/authorization/permissions";
import { Permissions } from "@common/decorators/auth.decorator";
import { ParseBigIntPipe } from "@core/http/pipes/parse-bigint.pipe";
import {
    ExpiryQuery,
    LowStockQuery,
    ExpiringQuery,
    InventoryOverviewQuery,
    LedgerQuery,
} from "../../store/inventory/inventory.dto";
import {
    ApiAdminInventoryOverview,
    ApiAdminStore,
    ApiExpiryBuckets,
    ApiLowStock,
    ApiInventoryExpiring,
    ApiInventoryLedger,
    ApiInventorySummary,
} from "../../store/inventory/inventory.swagger";
import { Get, Param, Query } from "@nestjs/common";
import { I18nLang } from "nestjs-i18n";
import { InventoryReportService } from "@modules/inventory/inventory-report.service";
import { AdminController } from "../admin-controller.decorator";

/**
 * Admin: pick any store (`GET admin/inventory/overview`) and manage its
 * inventory under `admin/stores/:storeId/inventory/...` with the same rules
 * as the store manager.
 */
@AdminController(
    "stores/:storeId/inventory",
    "Inventory reports",
    "Not ADMIN / SUPER_ADMIN or the `inventory.*` permission is missing",
)
export class AdminInventoryReportsController {
    constructor(private readonly report: InventoryReportService) {}

    // ----------------------------- read -----------------------------

    @Permissions(P.INVENTORY_READ)
    @ApiAdminStore()
    @ApiInventorySummary()
    @Get("summary")
    summary(@Param("storeId", ParseBigIntPipe) storeId: bigint) {
        return this.report.summary(storeId);
    }

    @Permissions(P.INVENTORY_READ)
    @ApiAdminStore()
    @ApiInventoryLedger()
    @Get("movements")
    ledger(
        @Param("storeId", ParseBigIntPipe) storeId: bigint,
        @Query() query: LedgerQuery,
        @I18nLang() lang: string,
    ) {
        return this.report.ledger(storeId, query, lang);
    }

    @Permissions(P.INVENTORY_READ)
    @ApiAdminStore()
    @ApiInventoryExpiring()
    @Get("expiring")
    expiring(
        @Param("storeId", ParseBigIntPipe) storeId: bigint,
        @Query() query: ExpiringQuery,
    ) {
        return this.report.expiring(storeId, query.days);
    }

    @Permissions(P.INVENTORY_READ)
    @ApiAdminStore()
    @ApiExpiryBuckets()
    @Get("expiry")
    expiryBuckets(
        @Param("storeId", ParseBigIntPipe) storeId: bigint,
        @Query() q: ExpiryQuery,
        @I18nLang() lang: string,
    ) {
        return this.report.expiryBuckets(storeId, q, lang);
    }

    @Permissions(P.INVENTORY_READ)
    @ApiAdminStore()
    @ApiLowStock()
    @Get("low-stock")
    lowStock(
        @Param("storeId", ParseBigIntPipe) storeId: bigint,
        @Query() q: LowStockQuery,
        @I18nLang() lang: string,
    ) {
        return this.report.lowStock(storeId, q, lang);
    }
}

/**
 * Admin: pick any store (`GET admin/inventory/overview`) and manage its
 * inventory under `admin/stores/:storeId/inventory/...` with the same rules
 * as the store manager.
 */
@AdminController(
    "inventory",
    "Inventory reports",
    "Not ADMIN / SUPER_ADMIN or the `inventory.*` permission is missing",
)
export class AdminInventoryOverviewController {
    constructor(private readonly report: InventoryReportService) {}

    @Permissions(P.INVENTORY_READ)
    @ApiAdminInventoryOverview()
    @Get("overview")
    overview(@Query() query: InventoryOverviewQuery, @I18nLang() lang: string) {
        return this.report.overview(query, lang);
    }
}
