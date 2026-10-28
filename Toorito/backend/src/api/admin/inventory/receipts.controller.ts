import { P } from "@common/authorization/permissions";
import { CurrentUser, Permissions } from "@common/decorators/auth.decorator";
import { AuthUser } from "@common/types/auth.type";
import { ParseBigIntPipe } from "@core/http/pipes/parse-bigint.pipe";
import {
    ReceiptListQuery,
    ReceiveGoodsDto,
} from "../../store/inventory/inventory.dto";
import {
    ApiAdminStore,
    ApiInventoryReceipt,
    ApiInventoryReceipts,
    ApiReceiveGoods,
} from "../../store/inventory/inventory.swagger";
import { Body, Get, Param, Post, Query } from "@nestjs/common";
import { I18nLang } from "nestjs-i18n";
import { ReceiptService } from "@modules/inventory/receipt.service";
import { AdminController } from "../admin-controller.decorator";

/**
 * Admin: pick any store (`GET admin/inventory/overview`) and manage its
 * inventory under `admin/stores/:storeId/inventory/...` with the same rules
 * as the store manager.
 */
@AdminController(
    "stores/:storeId/inventory",
    "Goods receipts",
    "Not ADMIN / SUPER_ADMIN or the `inventory.*` permission is missing",
)
export class AdminInventoryReceiptsController {
    constructor(private readonly goodsReceipts: ReceiptService) {}

    @Permissions(P.INVENTORY_READ)
    @ApiAdminStore()
    @ApiInventoryReceipts()
    @Get("receipts")
    receipts(
        @Param("storeId", ParseBigIntPipe) storeId: bigint,
        @Query() query: ReceiptListQuery,
    ) {
        return this.goodsReceipts.receipts(storeId, query);
    }

    @Permissions(P.INVENTORY_READ)
    @ApiAdminStore()
    @ApiInventoryReceipt()
    @Get("receipts/:id")
    receipt(
        @Param("storeId", ParseBigIntPipe) storeId: bigint,
        @Param("id", ParseBigIntPipe) id: bigint,
        @I18nLang() lang: string,
    ) {
        return this.goodsReceipts.receipt(storeId, id, lang);
    }

    @Permissions(P.INVENTORY_WRITE)
    @ApiAdminStore()
    @ApiReceiveGoods()
    @Post("receive")
    receive(
        @Param("storeId", ParseBigIntPipe) storeId: bigint,
        @Body() dto: ReceiveGoodsDto,
        @CurrentUser() user: AuthUser,
    ) {
        return this.goodsReceipts.receive(storeId, dto, user);
    }
}
