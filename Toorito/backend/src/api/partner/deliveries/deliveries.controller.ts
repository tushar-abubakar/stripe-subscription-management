import { Capability, CurrentUser } from "@common/decorators/auth.decorator";
import { AuthUser } from "@common/types/auth.type";
import { ParseBigIntPipe } from "@core/http/pipes/parse-bigint.pipe";
import {
    CompleteDeliveryDto,
    DeliveryProgressDto,
    ReasonDto,
} from "./delivery.dto";
import { DeliveryService } from "@modules/delivery/delivery.service";
import { Body, Get, HttpCode, Param, Patch, Post } from "@nestjs/common";
import { PartnerController } from "../partner-controller.decorator";

/** Endpoints used by the delivery partner app. */
@PartnerController("deliveries", "Deliveries")
export class PartnerDeliveriesController {
    constructor(private readonly delivery: DeliveryService) {}

    @Get()
    activeOrders(@CurrentUser() user: AuthUser) {
        return this.delivery.myDeliveries(user.id, true);
    }

    @Get("history")
    orderHistory(@CurrentUser() user: AuthUser) {
        return this.delivery.myDeliveries(user.id, false);
    }

    @Capability("ORDERS")
    @Post(":id/accept")
    @HttpCode(200)
    accept(
        @CurrentUser() user: AuthUser,
        @Param("id", ParseBigIntPipe) id: bigint,
    ) {
        return this.delivery.accept(user.id, id);
    }

    @Post(":id/reject")
    @HttpCode(200)
    reject(
        @CurrentUser() user: AuthUser,
        @Param("id", ParseBigIntPipe) id: bigint,
        @Body() dto: ReasonDto,
    ) {
        return this.delivery.reject(user.id, id, dto.reason);
    }

    @Capability("ORDERS")
    @Patch(":id/status")
    @HttpCode(200)
    progress(
        @CurrentUser() user: AuthUser,
        @Param("id", ParseBigIntPipe) id: bigint,
        @Body() dto: DeliveryProgressDto,
    ) {
        return this.delivery.progress(user.id, id, dto.status);
    }

    @Capability("ORDERS")
    @Post(":id/complete")
    @HttpCode(200)
    complete(
        @CurrentUser() user: AuthUser,
        @Param("id", ParseBigIntPipe) id: bigint,
        @Body() dto: CompleteDeliveryDto,
    ) {
        return this.delivery.complete(
            user.id,
            id,
            dto.code,
            dto.cashCollected,
            dto.proofMediaId,
        );
    }
}
