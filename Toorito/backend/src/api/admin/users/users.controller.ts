import { P } from "@common/authorization/permissions";
import { CurrentUser, Permissions } from "@common/decorators/auth.decorator";
import { AuthUser } from "@common/types/auth.type";
import { pageParams } from "@common/utils/helpers.util";
import { ParseBigIntPipe } from "@core/http/pipes/parse-bigint.pipe";
import {
    AdminCreateUserDto,
    AdminUpdateUserDto,
    ActivityQuery,
    AdminUserListQuery,
    HoldDto,
    ReleaseHoldDto,
    RejectDto,
    SetStatusDto,
    UnblockOtpDto,
    WalletAdjustDto,
    WalletQuery,
} from "./users.dto";
import { UsersService } from "@modules/users/users.service";
import {
    ApiAdminAdjustWallet,
    ApiAdminApproveUser,
    ApiAdminCreateUser,
    ApiAdminDeleteUser,
    ApiAdminRejectUser,
    ApiAdminSetUserStatus,
    ApiAdminUnblockOtp,
    ApiAdminUpdateUser,
    ApiAdminUserGet,
    ApiAdminUserList,
    ApiAdminUserWallet,
    ApiHoldUser,
    ApiReleaseUser,
    ApiWorkHistory,
} from "./users.swagger";
import {
    Body,
    Delete,
    Get,
    HttpCode,
    Param,
    Patch,
    Post,
    Query,
} from "@nestjs/common";
import { AdminController } from "../admin-controller.decorator";

/** Admin: user CRUD, status, approvals, wallet. */
@AdminController("users", "Users")
export class AdminUsersController {
    constructor(private readonly users: UsersService) {}

    @Permissions(P.USER_READ)
    @ApiAdminUserList()
    @Get()
    list(@Query() query: AdminUserListQuery) {
        return this.users.list({ ...query, ...pageParams(query) });
    }

    @Permissions(P.USER_CREATE)
    @ApiAdminCreateUser()
    @Post()
    create(@Body() dto: AdminCreateUserDto, @CurrentUser() actor: AuthUser) {
        return this.users.create(dto, actor);
    }

    // Must stay ABOVE ":id", otherwise "unblock-otp" is parsed as an id.
    @Permissions(P.OTP_UNBLOCK)
    @ApiAdminUnblockOtp()
    @Post("unblock-otp")
    @HttpCode(200)
    unblockOtp(@Body() dto: UnblockOtpDto, @CurrentUser() actor: AuthUser) {
        return this.users.unblockOtp(dto.phone, dto.role, actor);
    }

    @Permissions(P.USER_READ)
    @ApiAdminUserGet()
    @Get(":id")
    get(@Param("id", ParseBigIntPipe) id: bigint) {
        return this.users.get(id);
    }

    @Permissions(P.USER_UPDATE)
    @ApiAdminUpdateUser()
    @Patch(":id")
    update(
        @Param("id", ParseBigIntPipe) id: bigint,
        @Body() dto: AdminUpdateUserDto,
        @CurrentUser() actor: AuthUser,
    ) {
        return this.users.update(id, dto, actor);
    }

    @Permissions(P.USER_DELETE)
    @ApiAdminDeleteUser()
    @Delete(":id")
    remove(
        @Param("id", ParseBigIntPipe) id: bigint,
        @CurrentUser() actor: AuthUser,
    ) {
        return this.users.remove(id, actor);
    }

    @Permissions(P.USER_BLOCK)
    @ApiAdminSetUserStatus()
    @Patch(":id/status")
    setStatus(
        @Param("id", ParseBigIntPipe) id: bigint,
        @Body() dto: SetStatusDto,
        @CurrentUser() actor: AuthUser,
    ) {
        return this.users.setStatus(id, dto.status, dto.reason, actor);
    }

    @Permissions(P.USER_BLOCK)
    @ApiHoldUser("admin")
    @Post(":id/hold")
    @HttpCode(200)
    hold(
        @Param("id", ParseBigIntPipe) id: bigint,
        @Body() dto: HoldDto,
        @CurrentUser() actor: AuthUser,
    ) {
        return this.users.hold(id, dto, actor);
    }

    @Permissions(P.USER_BLOCK)
    @ApiReleaseUser("admin")
    @Post(":id/release")
    @HttpCode(200)
    release(
        @Param("id", ParseBigIntPipe) id: bigint,
        @Body() dto: ReleaseHoldDto,
        @CurrentUser() actor: AuthUser,
    ) {
        return this.users.release(id, dto.note, actor);
    }

    @Permissions(P.USER_READ)
    @ApiWorkHistory("admin")
    @Get(":id/activity")
    activity(
        @Param("id", ParseBigIntPipe) id: bigint,
        @Query() q: ActivityQuery,
    ) {
        return this.users.activity(id, q);
    }

    @Permissions(P.USER_APPROVE)
    @ApiAdminApproveUser()
    @Post(":id/approve")
    @HttpCode(200)
    approve(
        @Param("id", ParseBigIntPipe) id: bigint,
        @CurrentUser() actor: AuthUser,
    ) {
        return this.users.approve(id, actor);
    }

    @Permissions(P.USER_APPROVE)
    @ApiAdminRejectUser()
    @Post(":id/reject")
    @HttpCode(200)
    reject(
        @Param("id", ParseBigIntPipe) id: bigint,
        @Body() dto: RejectDto,
        @CurrentUser() actor: AuthUser,
    ) {
        return this.users.reject(id, dto.reason, actor);
    }

    @Permissions(P.USER_READ)
    @ApiAdminUserWallet()
    @Get(":id/wallet")
    wallet(
        @Param("id", ParseBigIntPipe) id: bigint,
        @Query() query: WalletQuery,
    ) {
        return this.users.wallet(id, { ...query, ...pageParams(query) });
    }

    @Permissions(P.WALLET_ADJUST)
    @ApiAdminAdjustWallet()
    @Post(":id/wallet")
    @HttpCode(200)
    adjustWallet(
        @Param("id", ParseBigIntPipe) id: bigint,
        @Body() dto: WalletAdjustDto,
        @CurrentUser() actor: AuthUser,
    ) {
        return this.users.adjustWallet(id, dto, actor);
    }
}
