import { AuthModule } from "@modules/auth/auth.module";
import { KycModule } from "@modules/kyc/kyc.module";
import { PaymentsModule } from "@modules/payments/payments.module";
import { UsersService } from "./users.service";
import { Module } from "@nestjs/common";

/**
 * Users feature module.
 *
 * - `AdminUserController`        — admin: user CRUD, status, approvals, wallet.
 * - `AdminAccessRoleController`  — super admin: access roles.
 * - `StoreTeamController`        — store manager: own team.
 * - `MeController`               — any user: profile, settings, avatar, phone, wallet, wishlist.
 * - `CustomerAddressController`  — customer: delivery addresses.
 *
 * AuthModule provides OtpService / TokenService; PaymentsModule the wallet
 * ledger. MediaModule, AddressModule, LocaleModule and CurrencyModule are global.
 */
@Module({
    imports: [AuthModule, PaymentsModule, KycModule],
    providers: [UsersService],
    exports: [UsersService],
})
export class UsersModule {}
