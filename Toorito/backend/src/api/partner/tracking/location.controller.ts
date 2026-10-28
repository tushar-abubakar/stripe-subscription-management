import { CurrentUser } from "@common/decorators/auth.decorator";
import { AuthUser } from "@common/types/auth.type";
import { LocationDto } from "../deliveries/delivery.dto";
import { DeliveryService } from "@modules/delivery/delivery.service";
import { Body, HttpCode, Post } from "@nestjs/common";
import { PartnerController } from "../partner-controller.decorator";

/** Endpoints used by the delivery partner app. */
@PartnerController("location", "Tracking")
export class PartnerLocationController {
    constructor(private readonly delivery: DeliveryService) {}

    /** REST fallback for the websocket location stream. */
    @Post()
    @HttpCode(200)
    updateLocation(@CurrentUser() user: AuthUser, @Body() dto: LocationDto) {
        return this.delivery.updateLocation(
            user,
            dto.lat,
            dto.lng,
            dto.heading,
        );
    }
}
