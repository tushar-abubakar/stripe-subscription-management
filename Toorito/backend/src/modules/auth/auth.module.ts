import {
    JwtAuthGuard,
    PermissionsGuard,
    RolesGuard,
} from "@core/auth/auth.guard";
import { AuthService } from "./auth.service";
import { OtpService } from "./otp.service";
import { TokenService } from "@core/auth/token.service";
import { CartModule } from "@modules/cart/cart.module";
import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";

@Module({
    imports: [JwtModule.register({}), CartModule],
    providers: [
        AuthService,
        OtpService,
        TokenService,
        JwtAuthGuard,
        RolesGuard,
        PermissionsGuard,
    ],
    exports: [
        AuthService,
        TokenService,
        OtpService,
        JwtAuthGuard,
        RolesGuard,
        PermissionsGuard,
    ],
})
export class AuthModule {}
