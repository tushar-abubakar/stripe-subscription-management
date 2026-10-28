import { AppConfigModule } from "@modules/app-config/app-config.module";
import { DeliveryModule } from "@modules/delivery/delivery.module";
import { KycModule } from "@modules/kyc/kyc.module";
import { Module } from "@nestjs/common";
import { PartnerAvailabilityController } from "./availability/availability.controller";
import { PartnerAppConfigController } from "./config/config.controller";
import { PartnerDeliveriesController } from "./deliveries/deliveries.controller";
import { PartnerKycController } from "./kyc/kyc.controller";
import { PartnerLocationController } from "./tracking/location.controller";

/** Delivery partner app API (prefix /partner via RouterModule). */
@Module({
    imports: [AppConfigModule, DeliveryModule, KycModule],
    controllers: [
        PartnerAvailabilityController,
        PartnerAppConfigController,
        PartnerDeliveriesController,
        PartnerKycController,
        PartnerLocationController,
    ],
})
export class PartnerApiModule {}
