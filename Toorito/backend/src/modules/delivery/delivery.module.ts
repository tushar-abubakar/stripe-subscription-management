import { AuthModule } from "@modules/auth/auth.module";
import { DeliveryService } from "./delivery.service";
import { TrackingGateway } from "./tracking.gateway";
import { KycModule } from "@modules/kyc/kyc.module";
import {
    NotificationsModule,
} from "@modules/notifications/notifications.module";
import { OrdersModule } from "@modules/orders/orders.module";
import { Module } from "@nestjs/common";

@Module({
    imports: [AuthModule, OrdersModule, NotificationsModule, KycModule],
    providers: [DeliveryService, TrackingGateway],
    exports: [DeliveryService],
})
export class DeliveryModule {}
