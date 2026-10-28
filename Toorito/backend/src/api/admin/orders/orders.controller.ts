import { P } from "@common/authorization/permissions";
import { CurrentUser, Permissions } from "@common/decorators/auth.decorator";
import { ListResponseDto } from "@common/dto/list-response.dto";
import { AuthUser } from "@common/types/auth.type";
import { ParseBigIntPipe } from "@core/http/pipes/parse-bigint.pipe";
import {
    AdminOrderListQuery,
    OrderStatusChangeDto,
} from "../../app/orders/orders.dto";
import { OrdersService } from "@modules/orders/orders.service";
import { Body, Get, HttpCode, Param, Patch, Query } from "@nestjs/common";
import { ApiOkResponse } from "@nestjs/swagger";
import { AdminController } from "../admin-controller.decorator";

@AdminController("orders", "Orders")
export class AdminOrdersController {
    constructor(private readonly orders: OrdersService) {}

    @Permissions(P.ORDER_READ)
    @ApiOkResponse({ type: ListResponseDto })
    @Get()
    list(@Query() query: AdminOrderListQuery) {
        return this.orders.adminList(query);
    }

    @Permissions(P.ORDER_READ)
    @Get(":id")
    get(@Param("id", ParseBigIntPipe) id: bigint) {
        return this.orders.storeGet(null, id);
    }

    @Permissions(P.ORDER_MANAGE)
    @Patch(":id/status")
    @HttpCode(200)
    changeStatus(
        @CurrentUser() user: AuthUser,
        @Param("id", ParseBigIntPipe) id: bigint,
        @Body() dto: OrderStatusChangeDto,
    ) {
        return this.orders.adminTransition(user, id, dto.status, dto.reason);
    }
}
