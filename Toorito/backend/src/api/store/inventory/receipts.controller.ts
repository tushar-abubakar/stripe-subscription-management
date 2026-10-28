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
    GrnEditRequestDto,
    ReceiptListQuery,
    ReceiveGoodsDto,
} from "./inventory.dto";
import {
    ApiGrnEditRequest,
    ApiInventoryReceipt,
    ApiInventoryReceipts,
    ApiReceiveGoods,
} from "./inventory.swagger";
import { Body, Get, HttpCode, Param, Post, Query } from "@nestjs/common";
import { UserRole } from "@prisma-client/enums";
import { I18nLang } from "nestjs-i18n";
import { ReceiptService } from "@modules/inventory/receipt.service";
import { StoreController } from "../store-controller.decorator";

/**
 * Store manager / staff: inventory of their own store.
 * Reads + stock operations are open to staff; listing & pricing are manager-only.
 * NOTE: static routes must stay above `:id` routes.
 */
@StoreController("inventory", "Goods receipts", {
    forbidden:
        "Not STORE_MANAGER / STORE_STAFF, permission missing, no store assigned, or a manager-only action",
})
export class StoreInventoryReceiptsController {
    constructor(
        private readonly goodsReceipts: ReceiptService,
        private readonly storeScope: StoreScopeService,
    ) {}

    @Roles(UserRole.STORE_MANAGER)
    @Permissions(P.INVENTORY_WRITE)
    @ApiGrnEditRequest()
    @Post("receipts/:id/edit-request")
    @HttpCode(200)
    grnEdit(
        @Param("id", ParseBigIntPipe) id: bigint,
        @Body() dto: GrnEditRequestDto,
        @CurrentUser() u: AuthUser,
    ) {
        return this.goodsReceipts.requestGrnEdit(
            this.storeScope.scope(u),
            id,
            dto,
            u,
        );
    }

    @Permissions(P.INVENTORY_READ)
    @ApiInventoryReceipts()
    @Get("receipts")
    receipts(@Query() query: ReceiptListQuery, @CurrentUser() u: AuthUser) {
        return this.goodsReceipts.receipts(this.storeScope.scope(u), query);
    }

    @Permissions(P.INVENTORY_READ)
    @ApiInventoryReceipt()
    @Get("receipts/:id")
    receipt(
        @Param("id", ParseBigIntPipe) id: bigint,
        @CurrentUser() u: AuthUser,
        @I18nLang() lang: string,
    ) {
        return this.goodsReceipts.receipt(this.storeScope.scope(u), id, lang);
    }

    // ------------------- stock in / out (staff ok) -------------------

    @Capability("INVENTORY")
    @Permissions(P.INVENTORY_WRITE)
    @ApiReceiveGoods()
    @Post("receive")
    receive(@Body() d: ReceiveGoodsDto, @CurrentUser() u: AuthUser) {
        return this.goodsReceipts.receive(this.storeScope.scope(u), d, u);
    }
}
