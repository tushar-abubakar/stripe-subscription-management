import {
    ClientIp,
    CurrentUser,
    Roles,
} from "@common/decorators/auth.decorator";
import { AuthUser } from "@common/types/auth.type";
import { pageParams } from "@common/utils/helpers.util";
import {
    ActivityQuery,
    PhoneChangeRequestDto,
    PhoneChangeVerifyDto,
    ProfileDto,
    WalletQuery,
} from "../../admin/users/users.dto";
import { MediaFileInterceptor } from "../media/media-file.interceptor";
import { MediaUploadExceptionFilter } from "../media/media-upload.filter";
import type { UploadedFile as MediaUpload } from "@modules/media/media.service";
import { UsersService } from "@modules/users/users.service";
import {
    ApiWorkHistory,
    ApiMyProfile,
    ApiMyWallet,
    ApiRemoveMyAvatar,
    ApiRequestPhoneChange,
    ApiSetMyAvatar,
    ApiUpdateMyProfile,
    ApiVerifyPhoneChange,
} from "../../admin/users/users.swagger";
import {
    Body,
    Delete,
    Get,
    HttpCode,
    Patch,
    Post,
    Put,
    Query,
    Req,
    UploadedFile,
    UseFilters,
    UseInterceptors,
} from "@nestjs/common";
import { UserRole } from "@prisma-client/enums";
import type { Request } from "express";
import { AccountController } from "../account-controller.decorator";

/** IP / user agent / device for OTP audit logs. */
export const otpCtx = (ip: string, req: Request, deviceId?: string) => ({
    ip,
    deviceId,
    ua: req.headers["user-agent"],
});

/** Any signed-in user: own profile, settings, avatar, phone, wallet; customers: wishlist. */
@AccountController("", "Profile")
export class AccountProfileController {
    constructor(private readonly users: UsersService) {}

    @ApiMyProfile()
    @Get("profile")
    profile(@CurrentUser() user: AuthUser) {
        return this.users.profile(user.id);
    }

    @ApiUpdateMyProfile()
    @Patch("profile")
    updateProfile(@CurrentUser() user: AuthUser, @Body() dto: ProfileDto) {
        return this.users.updateProfile(user.id, dto);
    }

    @ApiSetMyAvatar()
    @Put("avatar")
    @UseFilters(MediaUploadExceptionFilter)
    @UseInterceptors(MediaFileInterceptor)
    setAvatar(
        @CurrentUser() user: AuthUser,
        @UploadedFile() file: MediaUpload,
    ) {
        return this.users.setAvatar(user, file);
    }

    @ApiRemoveMyAvatar()
    @Delete("avatar")
    removeAvatar(@CurrentUser() user: AuthUser) {
        return this.users.removeAvatar(user.id);
    }

    @Roles(
        UserRole.STORE_STAFF,
        UserRole.STORE_MANAGER,
        UserRole.DELIVERY_PARTNER,
    )
    @ApiWorkHistory("self")
    @Get("work-history")
    workHistory(@CurrentUser() user: AuthUser, @Query() q: ActivityQuery) {
        return this.users.activity(user.id, q);
    }

    @ApiMyWallet()
    @Get("wallet")
    wallet(@CurrentUser() user: AuthUser, @Query() query: WalletQuery) {
        return this.users.wallet(user.id, { ...query, ...pageParams(query) });
    }

    @ApiRequestPhoneChange()
    @Post("phone/request-otp")
    @HttpCode(200)
    requestPhoneChange(
        @CurrentUser() user: AuthUser,
        @Body() dto: PhoneChangeRequestDto,
        @ClientIp() ip: string,
        @Req() req: Request,
    ) {
        return this.users.requestPhoneChange(
            user,
            dto.newPhone,
            otpCtx(ip, req),
        );
    }

    @ApiVerifyPhoneChange()
    @Post("phone/verify")
    @HttpCode(200)
    verifyPhoneChange(
        @CurrentUser() user: AuthUser,
        @Body() dto: PhoneChangeVerifyDto,
        @ClientIp() ip: string,
        @Req() req: Request,
    ) {
        return this.users.verifyPhoneChange(
            user,
            dto,
            otpCtx(ip, req, dto.deviceId),
        );
    }
}
