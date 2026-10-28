import { P } from "@common/authorization/permissions";
import { StoreScopeService } from "@common/authorization/store-scope.service";
import {
    Capability,
    CurrentUser,
    Permissions,
    Roles,
} from "@common/decorators/auth.decorator";
import { AuthUser } from "@common/types/auth.type";
import { ParseBigIntPipe } from "@core/http/pipes/parse-bigint.pipe";
import {
    AdjustStockDto,
    BatchStatusDto,
    MovementQuery,
    StockOutDto,
} from "./inventory.dto";
import {
    ApiAdjustStock,
    ApiBatchStatus,
    ApiInventoryBatches,
    ApiInventoryListingMovements,
    ApiInventoryScan,
    ApiStockOut,
} from "./inventory.swagger";
import { Body, Get, Param, Patch, Post, Query } from "@nestjs/common";
import { UserRole } from "@prisma-client/enums";
import { StockService } from "@modules/inventory/stock.service";
import { StoreController } from "../store-controller.decorator";

/**
 * Store manager / staff: inventory of their own store.
 * Reads + stock operations are open to staff; listing & pricing are manager-only.
 * NOTE: static routes must stay above `:id` routes.
 */
@StoreController("inventory", "Stock", {
    forbidden:
        "Not STORE_MANAGER / STORE_STAFF, permission missing, no store assigned, or a manager-only action",
})
export class StoreInventoryStockController {
    constructor(
        private readonly stock: StockService,
        private readonly storeScope: StoreScopeService,
    ) {}

    @Permissions(P.INVENTORY_READ)
    @ApiInventoryBatches()
    @Get("listings/:id/batches")
    batches(
        @Param("id", ParseBigIntPipe) id: bigint,
        @CurrentUser() u: AuthUser,
    ) {
        return this.stock.listBatches(this.storeScope.scope(u), id);
    }

    @Permissions(P.INVENTORY_READ)
    @ApiInventoryListingMovements()
    @Get("listings/:id/movements")
    movements(
        @Param("id", ParseBigIntPipe) id: bigint,
        @Query() query: MovementQuery,
        @CurrentUser() u: AuthUser,
    ) {
        return this.stock.movements(this.storeScope.scope(u), id, query);
    }

    /** Barcode lookup for quick stock-in / checkout. */
    @Permissions(P.INVENTORY_READ)
    @ApiInventoryScan()
    @Get("scan/:code")
    scan(@Param("code") code: string, @CurrentUser() u: AuthUser) {
        return this.stock.scan(this.storeScope.scope(u), code);
    }

    @Capability("INVENTORY")
    @Permissions(P.INVENTORY_WRITE)
    @ApiStockOut()
    @Post("stock-out")
    stockOut(@Body() d: StockOutDto, @CurrentUser() u: AuthUser) {
        return this.stock.stockOut(this.storeScope.scope(u), d, u);
    }

    @Capability("INVENTORY")
    @Permissions(P.INVENTORY_WRITE)
    @ApiAdjustStock()
    @Post("adjust")
    adjust(@Body() d: AdjustStockDto, @CurrentUser() u: AuthUser) {
        return this.stock.adjust(this.storeScope.scope(u), d, u);
    }

    @Roles(UserRole.STORE_MANAGER)
    @Permissions(P.INVENTORY_WRITE)
    @ApiBatchStatus()
    @Patch("batches/:id/status")
    batchStatus(
        @Param("id", ParseBigIntPipe) id: bigint,
        @Body() d: BatchStatusDto,
        @CurrentUser() u: AuthUser,
    ) {
        return this.stock.setBatchStatus(
            this.storeScope.scope(u),
            id,
            d.status,
            d.clearancePrice,
            u,
        );
    }
}
