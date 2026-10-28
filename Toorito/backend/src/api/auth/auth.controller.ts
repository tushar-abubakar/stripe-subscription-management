import {
    ClientIp,
    CurrentUser,
    Public,
} from "@common/decorators/auth.decorator";
import { AuthUser } from "@common/types/auth.type";
import {
    ChallengeVerifyDto,
    CustomerVerifyOtpDto,
    DeliveryVerifyOtpDto,
    PasswordLoginDto,
    RefreshDto,
    SendOtpDto,
    StaffVerifyOtpDto,
} from "./auth.dto";
import { AuthService } from "@modules/auth/auth.service";
import { AUTH_SWAGGER_EXAMPLES } from "./auth.swagger";
import { TokenService } from "@core/auth/token.service";
import { Body, Get, HttpCode, Post, Req } from "@nestjs/common";
import {
    ApiBadRequestResponse,
    ApiBearerAuth,
    ApiForbiddenResponse,
    ApiInternalServerErrorResponse,
    ApiNotFoundResponse,
    ApiOkResponse,
    ApiOperation,
    ApiTooManyRequestsResponse,
    ApiUnauthorizedResponse,
} from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import { UserRole } from "@prisma-client/enums";
import { Request } from "express";
import { AuthApiController } from "./auth-controller.decorator";

/** Rate limits: max requests per client per minute. */
export const THROTTLE = {
    requestOtp: { default: { limit: 10, ttl: 60_000 } },
    verifyOtp: { default: { limit: 15, ttl: 60_000 } },
    passwordLogin: { default: { limit: 8, ttl: 60_000 } },
    verifyChallenge: { default: { limit: 10, ttl: 60_000 } },
};

export const ctxOf = (ip: string, req: Request, deviceId?: string) => ({
    ip,
    deviceId,
    ua: req.headers["user-agent"],
});

/**
 * All authentication routes live under `/auth`.
 *
 * - `/auth/{customer|delivery|staff}/request-otp | verify-otp`  phone + OTP
 * - `/auth/{admin|store}/login | verify-otp`                    password + OTP
 * - `/auth/refresh | logout | logout-all | me`                  session
 */
@AuthApiController("", "Login & sessions")
export class AuthController {
    constructor(
        private readonly auth: AuthService,
        private readonly tokens: TokenService,
    ) {}

    /* ───────────── Customer: phone + OTP ─────────────
     * Sign-up / login accepts: phone, OTP code, optional name,
     * optional guest cart token, device information.
     */

    @Public()
    @Throttle(THROTTLE.requestOtp)
    @ApiOperation({
        operationId: "customerRequestOtp",
        summary: "Send a login OTP to a customer phone",
    })
    @ApiOkResponse({
        description: "OTP sent successfully",
        schema: { example: AUTH_SWAGGER_EXAMPLES.otpSent },
    })
    @ApiBadRequestResponse({
        description: "Bad request or validation failure",
        schema: { example: AUTH_SWAGGER_EXAMPLES.badRequest },
    })
    @ApiForbiddenResponse({
        description: "The account or request is not permitted",
        schema: { example: AUTH_SWAGGER_EXAMPLES.forbidden },
    })
    @ApiTooManyRequestsResponse({
        description: "Rate limit or OTP cooldown reached",
        schema: { example: AUTH_SWAGGER_EXAMPLES.tooManyRequests },
    })
    @ApiInternalServerErrorResponse({
        description: "Unexpected server error",
        schema: { example: AUTH_SWAGGER_EXAMPLES.internalServerError },
    })
    @Post("customer/request-otp")
    @HttpCode(200)
    requestCustomerOtp(
        @Body() dto: SendOtpDto,
        @ClientIp() ip: string,
        @Req() req: Request,
    ) {
        return this.auth.sendOtp(UserRole.CUSTOMER, dto, ctxOf(ip, req));
    }

    @Public()
    @Throttle(THROTTLE.verifyOtp)
    @ApiOperation({
        operationId: "customerVerifyOtp",
        summary: "Verify the OTP and sign the customer in (or up)",
    })
    @ApiOkResponse({
        description: "OTP verified; session created",
        schema: { example: AUTH_SWAGGER_EXAMPLES.otpVerified },
    })
    @ApiBadRequestResponse({
        description: "Bad request or validation failure",
        schema: { example: AUTH_SWAGGER_EXAMPLES.badRequest },
    })
    @ApiUnauthorizedResponse({
        description: "Authentication failed or token is invalid/expired",
        schema: { example: AUTH_SWAGGER_EXAMPLES.unauthorized },
    })
    @ApiForbiddenResponse({
        description: "The account or request is not permitted",
        schema: { example: AUTH_SWAGGER_EXAMPLES.forbidden },
    })
    @ApiNotFoundResponse({
        description: "The requested resource was not found",
        schema: { example: AUTH_SWAGGER_EXAMPLES.notFound },
    })
    @ApiTooManyRequestsResponse({
        description: "Rate limit or OTP cooldown reached",
        schema: { example: AUTH_SWAGGER_EXAMPLES.tooManyRequests },
    })
    @ApiInternalServerErrorResponse({
        description: "Unexpected server error",
        schema: { example: AUTH_SWAGGER_EXAMPLES.internalServerError },
    })
    @Post("customer/verify-otp")
    @HttpCode(200)
    verifyCustomerOtp(
        @Body() dto: CustomerVerifyOtpDto,
        @ClientIp() ip: string,
        @Req() req: Request,
    ) {
        return this.auth.verifyOtp(
            UserRole.CUSTOMER,
            dto,
            ctxOf(ip, req, dto.deviceId),
        );
    }

    /* ───────────── Delivery partner: phone + OTP ─────────────
     * Sign-up additionally needs: name, storeId, vehicleType,
     * optional vehicleNumber.
     */

    @Public()
    @Throttle(THROTTLE.requestOtp)
    @ApiOperation({
        operationId: "deliveryRequestOtp",
        summary: "Send a login OTP to a delivery partner phone",
    })
    @ApiOkResponse({
        description: "OTP sent successfully",
        schema: { example: AUTH_SWAGGER_EXAMPLES.otpSent },
    })
    @ApiBadRequestResponse({
        description: "Bad request or validation failure",
        schema: { example: AUTH_SWAGGER_EXAMPLES.badRequest },
    })
    @ApiForbiddenResponse({
        description: "The account or request is not permitted",
        schema: { example: AUTH_SWAGGER_EXAMPLES.forbidden },
    })
    @ApiNotFoundResponse({
        description: "The requested resource was not found",
        schema: { example: AUTH_SWAGGER_EXAMPLES.notFound },
    })
    @ApiTooManyRequestsResponse({
        description: "Rate limit or OTP cooldown reached",
        schema: { example: AUTH_SWAGGER_EXAMPLES.tooManyRequests },
    })
    @ApiInternalServerErrorResponse({
        description: "Unexpected server error",
        schema: { example: AUTH_SWAGGER_EXAMPLES.internalServerError },
    })
    @Post("delivery/request-otp")
    @HttpCode(200)
    requestDeliveryOtp(
        @Body() dto: SendOtpDto,
        @ClientIp() ip: string,
        @Req() req: Request,
    ) {
        return this.auth.sendOtp(
            UserRole.DELIVERY_PARTNER,
            dto,
            ctxOf(ip, req),
        );
    }

    @Public()
    @Throttle(THROTTLE.verifyOtp)
    @ApiOperation({
        operationId: "deliveryVerifyOtp",
        summary: "Verify the OTP and sign the delivery partner in (or up)",
    })
    @ApiOkResponse({
        description: "OTP verified; session created",
        schema: { example: AUTH_SWAGGER_EXAMPLES.otpVerified },
    })
    @ApiBadRequestResponse({
        description: "Bad request or validation failure",
        schema: { example: AUTH_SWAGGER_EXAMPLES.badRequest },
    })
    @ApiUnauthorizedResponse({
        description: "Authentication failed or token is invalid/expired",
        schema: { example: AUTH_SWAGGER_EXAMPLES.unauthorized },
    })
    @ApiForbiddenResponse({
        description: "The account or request is not permitted",
        schema: { example: AUTH_SWAGGER_EXAMPLES.forbidden },
    })
    @ApiNotFoundResponse({
        description: "The requested resource was not found",
        schema: { example: AUTH_SWAGGER_EXAMPLES.notFound },
    })
    @ApiTooManyRequestsResponse({
        description: "Rate limit or OTP cooldown reached",
        schema: { example: AUTH_SWAGGER_EXAMPLES.tooManyRequests },
    })
    @ApiInternalServerErrorResponse({
        description: "Unexpected server error",
        schema: { example: AUTH_SWAGGER_EXAMPLES.internalServerError },
    })
    @Post("delivery/verify-otp")
    @HttpCode(200)
    verifyDeliveryOtp(
        @Body() dto: DeliveryVerifyOtpDto,
        @ClientIp() ip: string,
        @Req() req: Request,
    ) {
        return this.auth.verifyOtp(
            UserRole.DELIVERY_PARTNER,
            dto,
            ctxOf(ip, req, dto.deviceId),
        );
    }

    /* ───────────── Store staff: phone + OTP ─────────────
     * Sign-up additionally needs: name, storeId.
     */

    @Public()
    @Throttle(THROTTLE.requestOtp)
    @ApiOperation({
        operationId: "staffRequestOtp",
        summary: "Send a login OTP to a store staff phone",
    })
    @ApiOkResponse({
        description: "OTP sent successfully",
        schema: { example: AUTH_SWAGGER_EXAMPLES.otpSent },
    })
    @ApiBadRequestResponse({
        description: "Bad request or validation failure",
        schema: { example: AUTH_SWAGGER_EXAMPLES.badRequest },
    })
    @ApiForbiddenResponse({
        description: "The account or request is not permitted",
        schema: { example: AUTH_SWAGGER_EXAMPLES.forbidden },
    })
    @ApiNotFoundResponse({
        description: "The requested resource was not found",
        schema: { example: AUTH_SWAGGER_EXAMPLES.notFound },
    })
    @ApiTooManyRequestsResponse({
        description: "Rate limit or OTP cooldown reached",
        schema: { example: AUTH_SWAGGER_EXAMPLES.tooManyRequests },
    })
    @ApiInternalServerErrorResponse({
        description: "Unexpected server error",
        schema: { example: AUTH_SWAGGER_EXAMPLES.internalServerError },
    })
    @Post("staff/request-otp")
    @HttpCode(200)
    requestStaffOtp(
        @Body() dto: SendOtpDto,
        @ClientIp() ip: string,
        @Req() req: Request,
    ) {
        return this.auth.sendOtp(UserRole.STORE_STAFF, dto, ctxOf(ip, req));
    }

    @Public()
    @Throttle(THROTTLE.verifyOtp)
    @ApiOperation({
        operationId: "staffVerifyOtp",
        summary: "Verify the OTP and sign the store staff member in (or up)",
    })
    @ApiOkResponse({
        description: "OTP verified; session created",
        schema: { example: AUTH_SWAGGER_EXAMPLES.otpVerified },
    })
    @ApiBadRequestResponse({
        description: "Bad request or validation failure",
        schema: { example: AUTH_SWAGGER_EXAMPLES.badRequest },
    })
    @ApiUnauthorizedResponse({
        description: "Authentication failed or token is invalid/expired",
        schema: { example: AUTH_SWAGGER_EXAMPLES.unauthorized },
    })
    @ApiForbiddenResponse({
        description: "The account or request is not permitted",
        schema: { example: AUTH_SWAGGER_EXAMPLES.forbidden },
    })
    @ApiNotFoundResponse({
        description: "The requested resource was not found",
        schema: { example: AUTH_SWAGGER_EXAMPLES.notFound },
    })
    @ApiTooManyRequestsResponse({
        description: "Rate limit or OTP cooldown reached",
        schema: { example: AUTH_SWAGGER_EXAMPLES.tooManyRequests },
    })
    @ApiInternalServerErrorResponse({
        description: "Unexpected server error",
        schema: { example: AUTH_SWAGGER_EXAMPLES.internalServerError },
    })
    @Post("staff/verify-otp")
    @HttpCode(200)
    verifyStaffOtp(
        @Body() dto: StaffVerifyOtpDto,
        @ClientIp() ip: string,
        @Req() req: Request,
    ) {
        return this.auth.verifyOtp(
            UserRole.STORE_STAFF,
            dto,
            ctxOf(ip, req, dto.deviceId),
        );
    }

    /* ───────────── Admin / super admin: password, then OTP challenge ───────────── */

    @Public()
    @Throttle(THROTTLE.passwordLogin)
    @ApiOperation({
        operationId: "adminLogin",
        summary: "Start admin password login and issue an OTP challenge",
    })
    @ApiOkResponse({
        description: "Password accepted; OTP challenge created",
        schema: { example: AUTH_SWAGGER_EXAMPLES.challengeCreated },
    })
    @ApiBadRequestResponse({
        description: "Bad request or validation failure",
        schema: { example: AUTH_SWAGGER_EXAMPLES.badRequest },
    })
    @ApiUnauthorizedResponse({
        description: "Authentication failed or token is invalid/expired",
        schema: { example: AUTH_SWAGGER_EXAMPLES.unauthorized },
    })
    @ApiForbiddenResponse({
        description: "The account or request is not permitted",
        schema: { example: AUTH_SWAGGER_EXAMPLES.forbidden },
    })
    @ApiTooManyRequestsResponse({
        description: "Rate limit or OTP cooldown reached",
        schema: { example: AUTH_SWAGGER_EXAMPLES.tooManyRequests },
    })
    @ApiInternalServerErrorResponse({
        description: "Unexpected server error",
        schema: { example: AUTH_SWAGGER_EXAMPLES.internalServerError },
    })
    @Post("admin/login")
    @HttpCode(200)
    adminLogin(
        @Body() dto: PasswordLoginDto,
        @ClientIp() ip: string,
        @Req() req: Request,
    ) {
        return this.auth.passwordLogin(
            [UserRole.ADMIN, UserRole.SUPER_ADMIN],
            dto.phone,
            dto.password,
            ctxOf(ip, req),
        );
    }

    @Public()
    @Throttle(THROTTLE.verifyChallenge)
    @ApiOperation({
        operationId: "adminVerifyOtp",
        summary: "Verify the admin login OTP challenge",
    })
    @ApiOkResponse({
        description: "Challenge verified; session created",
        schema: { example: AUTH_SWAGGER_EXAMPLES.challengeVerified },
    })
    @ApiBadRequestResponse({
        description: "Bad request or validation failure",
        schema: { example: AUTH_SWAGGER_EXAMPLES.badRequest },
    })
    @ApiUnauthorizedResponse({
        description: "Authentication failed or token is invalid/expired",
        schema: { example: AUTH_SWAGGER_EXAMPLES.unauthorized },
    })
    @ApiForbiddenResponse({
        description: "The account or request is not permitted",
        schema: { example: AUTH_SWAGGER_EXAMPLES.forbidden },
    })
    @ApiTooManyRequestsResponse({
        description: "Rate limit or OTP cooldown reached",
        schema: { example: AUTH_SWAGGER_EXAMPLES.tooManyRequests },
    })
    @ApiInternalServerErrorResponse({
        description: "Unexpected server error",
        schema: { example: AUTH_SWAGGER_EXAMPLES.internalServerError },
    })
    @Post("admin/verify-otp")
    @HttpCode(200)
    verifyAdminOtp(
        @Body() dto: ChallengeVerifyDto,
        @ClientIp() ip: string,
        @Req() req: Request,
    ) {
        return this.auth.verifyChallenge(
            [UserRole.ADMIN, UserRole.SUPER_ADMIN],
            dto,
            ctxOf(ip, req, dto.deviceId),
        );
    }

    /* ───────────── Store manager: password, then OTP challenge ───────────── */

    @Public()
    @Throttle(THROTTLE.passwordLogin)
    @ApiOperation({
        operationId: "storeLogin",
        summary:
            "Start store manager password login and issue an OTP challenge",
    })
    @ApiOkResponse({
        description: "Password accepted; OTP challenge created",
        schema: { example: AUTH_SWAGGER_EXAMPLES.challengeCreated },
    })
    @ApiBadRequestResponse({
        description: "Bad request or validation failure",
        schema: { example: AUTH_SWAGGER_EXAMPLES.badRequest },
    })
    @ApiUnauthorizedResponse({
        description: "Authentication failed or token is invalid/expired",
        schema: { example: AUTH_SWAGGER_EXAMPLES.unauthorized },
    })
    @ApiForbiddenResponse({
        description: "The account or request is not permitted",
        schema: { example: AUTH_SWAGGER_EXAMPLES.forbidden },
    })
    @ApiTooManyRequestsResponse({
        description: "Rate limit or OTP cooldown reached",
        schema: { example: AUTH_SWAGGER_EXAMPLES.tooManyRequests },
    })
    @ApiInternalServerErrorResponse({
        description: "Unexpected server error",
        schema: { example: AUTH_SWAGGER_EXAMPLES.internalServerError },
    })
    @Post("store/login")
    @HttpCode(200)
    storeLogin(
        @Body() dto: PasswordLoginDto,
        @ClientIp() ip: string,
        @Req() req: Request,
    ) {
        return this.auth.passwordLogin(
            [UserRole.STORE_MANAGER],
            dto.phone,
            dto.password,
            ctxOf(ip, req),
        );
    }

    @Public()
    @Throttle(THROTTLE.verifyChallenge)
    @ApiOperation({
        operationId: "storeVerifyOtp",
        summary: "Verify the store manager login OTP challenge",
    })
    @ApiOkResponse({
        description: "Challenge verified; session created",
        schema: { example: AUTH_SWAGGER_EXAMPLES.challengeVerified },
    })
    @ApiBadRequestResponse({
        description: "Bad request or validation failure",
        schema: { example: AUTH_SWAGGER_EXAMPLES.badRequest },
    })
    @ApiUnauthorizedResponse({
        description: "Authentication failed or token is invalid/expired",
        schema: { example: AUTH_SWAGGER_EXAMPLES.unauthorized },
    })
    @ApiForbiddenResponse({
        description: "The account or request is not permitted",
        schema: { example: AUTH_SWAGGER_EXAMPLES.forbidden },
    })
    @ApiTooManyRequestsResponse({
        description: "Rate limit or OTP cooldown reached",
        schema: { example: AUTH_SWAGGER_EXAMPLES.tooManyRequests },
    })
    @ApiInternalServerErrorResponse({
        description: "Unexpected server error",
        schema: { example: AUTH_SWAGGER_EXAMPLES.internalServerError },
    })
    @Post("store/verify-otp")
    @HttpCode(200)
    verifyStoreOtp(
        @Body() dto: ChallengeVerifyDto,
        @ClientIp() ip: string,
        @Req() req: Request,
    ) {
        return this.auth.verifyChallenge(
            [UserRole.STORE_MANAGER],
            dto,
            ctxOf(ip, req, dto.deviceId),
        );
    }

    /* ───────────── Session (all roles) ───────────── */

    @Public()
    @ApiOperation({
        operationId: "refreshSession",
        summary: "Exchange a refresh token for a new token pair",
    })
    @ApiOkResponse({
        description: "Session tokens rotated successfully",
        schema: { example: AUTH_SWAGGER_EXAMPLES.tokenPair },
    })
    @ApiBadRequestResponse({
        description: "Bad request or validation failure",
        schema: { example: AUTH_SWAGGER_EXAMPLES.badRequest },
    })
    @ApiUnauthorizedResponse({
        description: "Authentication failed or token is invalid/expired",
        schema: { example: AUTH_SWAGGER_EXAMPLES.unauthorized },
    })
    @ApiForbiddenResponse({
        description: "The account or request is not permitted",
        schema: { example: AUTH_SWAGGER_EXAMPLES.forbidden },
    })
    @ApiInternalServerErrorResponse({
        description: "Unexpected server error",
        schema: { example: AUTH_SWAGGER_EXAMPLES.internalServerError },
    })
    @Post("refresh")
    @HttpCode(200)
    refresh(@Body() dto: RefreshDto, @ClientIp() ip: string) {
        return this.tokens.refresh(dto.refreshToken, {
            pushToken: dto.pushToken,
            ip,
        });
    }

    @ApiBearerAuth()
    @ApiOperation({
        operationId: "logout",
        summary: "End the current session",
    })
    @ApiOkResponse({
        description: "Operation completed successfully",
        schema: { example: AUTH_SWAGGER_EXAMPLES.success },
    })
    @ApiUnauthorizedResponse({
        description: "Authentication failed or token is invalid/expired",
        schema: { example: AUTH_SWAGGER_EXAMPLES.unauthorized },
    })
    @ApiForbiddenResponse({
        description: "The account or request is not permitted",
        schema: { example: AUTH_SWAGGER_EXAMPLES.forbidden },
    })
    @ApiInternalServerErrorResponse({
        description: "Unexpected server error",
        schema: { example: AUTH_SWAGGER_EXAMPLES.internalServerError },
    })
    @Post("logout")
    @HttpCode(200)
    async logout(@CurrentUser() user: AuthUser) {
        await this.tokens.logout(user);

        return { success: true };
    }

    @ApiBearerAuth()
    @ApiOperation({
        operationId: "logoutAll",
        summary: "End every session of the current user",
    })
    @ApiOkResponse({
        description: "Operation completed successfully",
        schema: { example: AUTH_SWAGGER_EXAMPLES.success },
    })
    @ApiUnauthorizedResponse({
        description: "Authentication failed or token is invalid/expired",
        schema: { example: AUTH_SWAGGER_EXAMPLES.unauthorized },
    })
    @ApiForbiddenResponse({
        description: "The account or request is not permitted",
        schema: { example: AUTH_SWAGGER_EXAMPLES.forbidden },
    })
    @ApiInternalServerErrorResponse({
        description: "Unexpected server error",
        schema: { example: AUTH_SWAGGER_EXAMPLES.internalServerError },
    })
    @Post("logout-all")
    @HttpCode(200)
    async logoutAll(@CurrentUser() user: AuthUser) {
        await this.tokens.revokeAllForUser(user.id);

        return { success: true };
    }

    @ApiBearerAuth()
    @ApiOperation({
        operationId: "me",
        summary: "Current user profile and permissions",
    })
    @ApiOkResponse({
        description: "Current user profile and permissions",
        schema: { example: AUTH_SWAGGER_EXAMPLES.me },
    })
    @ApiUnauthorizedResponse({
        description: "Authentication failed or token is invalid/expired",
        schema: { example: AUTH_SWAGGER_EXAMPLES.unauthorized },
    })
    @ApiForbiddenResponse({
        description: "The account or request is not permitted",
        schema: { example: AUTH_SWAGGER_EXAMPLES.forbidden },
    })
    @ApiNotFoundResponse({
        description: "The requested resource was not found",
        schema: { example: AUTH_SWAGGER_EXAMPLES.notFound },
    })
    @ApiInternalServerErrorResponse({
        description: "Unexpected server error",
        schema: { example: AUTH_SWAGGER_EXAMPLES.internalServerError },
    })
    @Get("me")
    me(@CurrentUser() user: AuthUser) {
        return this.auth.me(user);
    }
}
