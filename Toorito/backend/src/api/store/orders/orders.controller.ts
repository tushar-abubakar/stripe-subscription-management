import { P } from "@common/authorization/permissions";
import { StoreScopeService } from "@common/authorization/store-scope.service";
import {
    CurrentUser,
    Capability,
    Permissions,
} from "@common/decorators/auth.decorator";
import { AuthUser } from "@common/types/auth.type";
import { ParseBigIntPipe } from "@core/http/pipes/parse-bigint.pipe";
import {
    OrderStatusChangeDto,
    PackDto,
    StoreOrderListQuery,
} from "../../app/orders/orders.dto";
import { OrdersService } from "@modules/orders/orders.service";
import { Body, Get, HttpCode, Param, Patch, Post, Query } from "@nestjs/common";
import { StoreController } from "../store-controller.decorator";

@StoreController("orders", "Orders")
export class StoreOrdersController {
    constructor(
        private readonly orders: OrdersService,
        private readonly storeScope: StoreScopeService,
    ) {}

    @Permissions(P.ORDER_READ)
    @Get()
    list(@CurrentUser() user: AuthUser, @Query() query: StoreOrderListQuery) {
        return this.orders.storeList(this.storeScope.scope(user), query);
    }

    @Permissions(P.ORDER_READ)
    @Get(":id")
    get(
        @CurrentUser() user: AuthUser,
        @Param("id", ParseBigIntPipe) id: bigint,
    ) {
        return this.orders.storeGet(this.storeScope.scope(user), id);
    }

    @Permissions(P.ORDER_MANAGE)
    @Patch(":id/status")
    @HttpCode(200)
    changeStatus(
        @CurrentUser() user: AuthUser,
        @Param("id", ParseBigIntPipe) id: bigint,
        @Body() dto: OrderStatusChangeDto,
    ) {
        return this.orders.storeTransition(user, id, dto.status, dto.reason);
    }

    /** Pack by barcode scan (`barcode`) or manually (`orderItemId`). */
    @Capability("ORDERS")
    @Permissions(P.ORDER_PACK)
    @Post(":id/pack")
    @HttpCode(200)
    pack(
        @CurrentUser() user: AuthUser,
        @Param("id", ParseBigIntPipe) id: bigint,
        @Body() dto: PackDto,
    ) {
        return this.orders.pack(user, id, dto);
    }

    @Capability("ORDERS")
    @Permissions(P.ORDER_PACK)
    @Post(":id/items/:itemId/out-of-stock")
    @HttpCode(200)
    markOutOfStock(
        @CurrentUser() user: AuthUser,
        @Param("id", ParseBigIntPipe) id: bigint,
        @Param("itemId", ParseBigIntPipe) itemId: bigint,
    ) {
        return this.orders.markOutOfStock(user, id, itemId);
    }
}
