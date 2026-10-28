import { P } from "@common/authorization/permissions";
import { StoreScopeService } from "@common/authorization/store-scope.service";
import { CurrentUser, Permissions } from "@common/decorators/auth.decorator";
import { AuthUser } from "@common/types/auth.type";
import { ParseBigIntPipe } from "@core/http/pipes/parse-bigint.pipe";
import { AssignDto } from "../../partner/deliveries/delivery.dto";
import { DeliveryService } from "@modules/delivery/delivery.service";
import { Body, Get, HttpCode, Param, Post } from "@nestjs/common";
import { StoreController } from "../store-controller.decorator";

/**
 * Manual assignment for store managers (KYC review moved to /store/kyc).
 * Always scoped to the manager's own store via StoreScopeService (a manager
 * without a store gets 403 instead of an unscoped query).
 */
@StoreController("", "Delivery", { managerOnly: true })
export class StoreDeliveriesController {
    constructor(
        private readonly delivery: DeliveryService,
        private readonly storeScope: StoreScopeService,
    ) {}

    @Permissions(P.DELIVERY_ASSIGN)
    @Get("delivery/partners")
    availablePartners(@CurrentUser() user: AuthUser) {
        return this.delivery.availablePartners(this.storeScope.scope(user));
    }

    @Permissions(P.DELIVERY_ASSIGN)
    @Get("delivery/live")
    liveMap(@CurrentUser() user: AuthUser) {
        return this.delivery.liveMap(this.storeScope.scope(user));
    }

    @Permissions(P.DELIVERY_ASSIGN)
    @Post("orders/:id/assign")
    @HttpCode(200)
    assign(
        @CurrentUser() user: AuthUser,
        @Param("id", ParseBigIntPipe) id: bigint,
        @Body() dto: AssignDto,
    ) {
        return this.delivery.assign(id, BigInt(dto.partnerId), {
            id: user.id,
            storeId: this.storeScope.scope(user),
        });
    }
}
