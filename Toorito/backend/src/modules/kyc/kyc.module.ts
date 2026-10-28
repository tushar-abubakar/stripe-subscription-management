import { KycService } from "./kyc.service";
import {
    NotificationsModule,
} from "@modules/notifications/notifications.module";
import { Module } from "@nestjs/common";

/**
 * KYC for store staff and delivery partners (mandatory for both).
 * Members add documents; store managers review metadata and forward;
 * admins decide. Old documents are removed only through an approved request.
 */
@Module({
    imports: [NotificationsModule],
    providers: [KycService],
    exports: [KycService],
})
export class KycModule {}
