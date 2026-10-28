import { P } from "@common/authorization/permissions";
import { CurrentUser, Permissions } from "@common/decorators/auth.decorator";
import { AuthUser } from "@common/types/auth.type";
import { ParseBigIntPipe } from "@core/http/pipes/parse-bigint.pipe";
import {
    AdjustStockDto,
    BatchStatusDto,
    StockOutDto,
} from "../../store/inventory/inventory.dto";
import {
    ApiAdjustStock,
    ApiAdminStore,
    ApiBatchStatus,
    ApiInventoryBatches,
    ApiStockOut,
} from "../../store/inventory/inventory.swagger";
import { Body, Get, Param, Patch, Post } from "@nestjs/common";
import { StockService } from "@modules/inventory/stock.service";
import { AdminController } from "../admin-controller.decorator";

/**
 * Admin: pick any store (`GET admin/inventory/overview`) and manage its
 * inventory under `admin/stores/:storeId/inventory/...` with the same rules
 * as the store manager.
 */
@AdminController(
    "stores/:storeId/inventory",
    "Stock",
    "Not ADMIN / SUPER_ADMIN or the `inventory.*` permission is missing",
)
export class AdminInventoryStockController {
    constructor(private readonly stock: StockService) {}

    @Permissions(P.INVENTORY_READ)
    @ApiAdminStore()
    @ApiInventoryBatches()
    @Get("listings/:id/batches")
    batches(
        @Param("storeId", ParseBigIntPipe) storeId: bigint,
        @Param("id", ParseBigIntPipe) id: bigint,
    ) {
        return this.stock.listBatches(storeId, id);
    }

    @Permissions(P.INVENTORY_WRITE)
    @ApiAdminStore()
    @ApiStockOut()
    @Post("stock-out")
    stockOut(
        @Param("storeId", ParseBigIntPipe) storeId: bigint,
        @Body() dto: StockOutDto,
        @CurrentUser() user: AuthUser,
    ) {
        return this.stock.stockOut(storeId, dto, user);
    }

    @Permissions(P.INVENTORY_WRITE)
    @ApiAdminStore()
    @ApiAdjustStock()
    @Post("adjust")
    adjust(
        @Param("storeId", ParseBigIntPipe) storeId: bigint,
        @Body() dto: AdjustStockDto,
        @CurrentUser() user: AuthUser,
    ) {
        return this.stock.adjust(storeId, dto, user);
    }

    @Permissions(P.INVENTORY_WRITE)
    @ApiAdminStore()
    @ApiBatchStatus()
    @Patch("batches/:id/status")
    batchStatus(
        @Param("storeId", ParseBigIntPipe) storeId: bigint,
        @Param("id", ParseBigIntPipe) id: bigint,
        @Body() dto: BatchStatusDto,
        @CurrentUser() user: AuthUser,
    ) {
        return this.stock.setBatchStatus(
            storeId,
            id,
            dto.status,
            dto.clearancePrice,
            user,
        );
    }
}
