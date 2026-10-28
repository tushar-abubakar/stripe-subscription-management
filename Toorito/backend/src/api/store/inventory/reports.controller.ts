import { P } from "@common/authorization/permissions";
import { StoreScopeService } from "@common/authorization/store-scope.service";
import { CurrentUser, Permissions } from "@common/decorators/auth.decorator";
import { AuthUser } from "@common/types/auth.type";
import {
    ExpiryQuery,
    LowStockQuery,
    ExpiringQuery,
    LedgerQuery,
} from "./inventory.dto";
import {
    ApiExpiryBuckets,
    ApiLowStock,
    ApiInventoryExpiring,
    ApiInventoryLedger,
    ApiInventorySummary,
} from "./inventory.swagger";
import { Get, Query } from "@nestjs/common";
import { I18nLang } from "nestjs-i18n";
import { InventoryReportService } from "@modules/inventory/inventory-report.service";
import { StoreController } from "../store-controller.decorator";

/**
 * Store manager / staff: inventory of their own store.
 * Reads + stock operations are open to staff; listing & pricing are manager-only.
 * NOTE: static routes must stay above `:id` routes.
 */
@StoreController("inventory", "Inventory reports", {
    forbidden:
        "Not STORE_MANAGER / STORE_STAFF, permission missing, no store assigned, or a manager-only action",
})
export class StoreInventoryReportsController {
    constructor(
        private readonly report: InventoryReportService,
        private readonly storeScope: StoreScopeService,
    ) {}

    // ----------------------------- read -----------------------------

    @Permissions(P.INVENTORY_READ)
    @ApiInventorySummary()
    @Get("summary")
    summary(@CurrentUser() u: AuthUser) {
        return this.report.summary(this.storeScope.scope(u));
    }

    @Permissions(P.INVENTORY_READ)
    @ApiExpiryBuckets()
    @Get("expiry")
    expiry(
        @Query() q: ExpiryQuery,
        @CurrentUser() u: AuthUser,
        @I18nLang() lang: string,
    ) {
        return this.report.expiryBuckets(this.storeScope.scope(u), q, lang);
    }

    @Permissions(P.INVENTORY_READ)
    @ApiLowStock()
    @Get("low-stock")
    lowStock(
        @Query() q: LowStockQuery,
        @CurrentUser() u: AuthUser,
        @I18nLang() lang: string,
    ) {
        return this.report.lowStock(this.storeScope.scope(u), q, lang);
    }

    @Permissions(P.INVENTORY_READ)
    @ApiInventoryLedger()
    @Get("movements")
    ledger(
        @Query() query: LedgerQuery,
        @CurrentUser() u: AuthUser,
        @I18nLang() lang: string,
    ) {
        return this.report.ledger(this.storeScope.scope(u), query, lang);
    }

    @Permissions(P.INVENTORY_READ)
    @ApiInventoryExpiring()
    @Get("expiring")
    expiringBatches(@Query() query: ExpiringQuery, @CurrentUser() u: AuthUser) {
        // default / max days come from config inside the service
        return this.report.expiring(this.storeScope.scope(u), query.days);
    }
}
