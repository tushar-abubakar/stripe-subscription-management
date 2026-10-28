import { CartModule } from "@modules/cart/cart.module";
import { InventoryModule } from "@modules/inventory/inventory.module";
import {
    NotificationsModule,
} from "@modules/notifications/notifications.module";
import { CouponsService } from "./coupons.service";
import { OrdersService } from "./orders.service";
import { PaymentsModule } from "@modules/payments/payments.module";
import { StoresModule } from "@modules/stores/stores.module";
import { Module } from "@nestjs/common";

@Module({
    imports: [
        CartModule,
        InventoryModule,
        NotificationsModule,
        PaymentsModule,
        StoresModule,
    ],
    providers: [OrdersService, CouponsService],
    exports: [OrdersService, CouponsService],
})
export class OrdersModule {}
