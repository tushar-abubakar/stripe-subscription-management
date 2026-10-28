import { PaymentsService } from "./payments.service";
import { Module } from "@nestjs/common";
import {
    NotificationsModule,
} from "@modules/notifications/notifications.module";

@Module({
    imports: [NotificationsModule],
    providers: [PaymentsService],
    exports: [PaymentsService],
})
export class PaymentsModule {}
