import { P } from "@common/authorization/permissions";
import { CurrentUser, Permissions } from "@common/decorators/auth.decorator";
import { AuthUser } from "@common/types/auth.type";
import { ParseBigIntPipe } from "@core/http/pipes/parse-bigint.pipe";
import { AssignDto } from "../../partner/deliveries/delivery.dto";
import { DeliveryService } from "@modules/delivery/delivery.service";
import { Body, HttpCode, Param, Post } from "@nestjs/common";
import { AdminController } from "../admin-controller.decorator";

/** Manual assignment for admins (any store). KYC review/listing lives in AdminController. */
@AdminController("delivery", "Delivery")
export class AdminDeliveryController {
    constructor(private readonly delivery: DeliveryService) {}

    @Permissions(P.DELIVERY_ASSIGN)
    @Post("orders/:id/assign")
    @HttpCode(200)
    assign(
        @CurrentUser() user: AuthUser,
        @Param("id", ParseBigIntPipe) id: bigint,
        @Body() dto: AssignDto,
    ) {
        // Admins have no store, so the order's own store is used.
        return this.delivery.assign(id, BigInt(dto.partnerId), {
            id: user.id,
            storeId: null,
        });
    }
}
