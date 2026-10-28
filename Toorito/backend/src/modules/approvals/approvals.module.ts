import { ApprovalsService } from "./approvals.service";
import { ReturnsService } from "./returns.service";
import { InventoryModule } from "@modules/inventory/inventory.module";
import { KycModule } from "@modules/kyc/kyc.module";
import {
    NotificationsModule,
} from "@modules/notifications/notifications.module";
import { PaymentsModule } from "@modules/payments/payments.module";
import { UsersModule } from "@modules/users/users.module";
import { Module } from "@nestjs/common";

/**
 * One approval inbox. Domain modules open requests (approvals.repo) and
 * expose `handlers()`; this module lists them and runs decisions.
 * Store-level: customer returns / exchanges. Admin-level: everything else.
 */
@Module({
    imports: [InventoryModule, KycModule, UsersModule, PaymentsModule, NotificationsModule],
    providers: [ApprovalsService, ReturnsService],
    exports: [ApprovalsService, ReturnsService],
})
export class ApprovalsModule {}
