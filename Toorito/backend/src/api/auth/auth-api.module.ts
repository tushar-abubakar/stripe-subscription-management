import { AuthModule } from "@modules/auth/auth.module";
import { Module } from "@nestjs/common";
import { AuthController } from "./auth.controller";

/** Login, OTP, refresh, logout (prefix /auth via RouterModule). */
@Module({
    imports: [AuthModule],
    controllers: [
        AuthController,
    ],
})
export class AuthApiModule {}
