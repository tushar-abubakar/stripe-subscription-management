import { Capability, CurrentUser } from "@common/decorators/auth.decorator";
import { AuthUser } from "@common/types/auth.type";
import { OnlineDto } from "../deliveries/delivery.dto";
import { DeliveryService } from "@modules/delivery/delivery.service";
import { Body, HttpCode, Patch } from "@nestjs/common";
import { PartnerController } from "../partner-controller.decorator";

/** Endpoints used by the delivery partner app. */
@PartnerController("availability", "Availability")
export class PartnerAvailabilityController {
    constructor(private readonly delivery: DeliveryService) {}

    @Capability("ORDERS")
    @Patch()
    @HttpCode(200)
    setOnline(@CurrentUser() user: AuthUser, @Body() dto: OnlineDto) {
        return this.delivery.setOnline(user, dto.online);
    }
}
