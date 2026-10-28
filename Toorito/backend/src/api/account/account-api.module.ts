import { ApprovalsModule } from "@modules/approvals/approvals.module";
import { KycModule } from "@modules/kyc/kyc.module";
import { NotificationsModule } from "@modules/notifications/notifications.module";
import { UsersModule } from "@modules/users/users.module";
import { Module } from "@nestjs/common";
import { AccountApprovalsController } from "./approvals/approvals.controller";
import { AccountKycController } from "./kyc/kyc.controller";
import { AccountMediaController } from "./media/media.controller";
import { AccountNotificationsController } from "./notifications/notifications.controller";
import { AccountProfileController } from "./profile/profile.controller";

/** Signed-in user's own account, any role (prefix /account via RouterModule). */
@Module({
    imports: [ApprovalsModule, KycModule, NotificationsModule, UsersModule],
    controllers: [
        AccountApprovalsController,
        AccountKycController,
        AccountMediaController,
        AccountNotificationsController,
        AccountProfileController,
    ],
})
export class AccountApiModule {}
