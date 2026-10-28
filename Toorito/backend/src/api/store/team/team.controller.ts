import { P } from "@common/authorization/permissions";
import { StoreScopeService } from "@common/authorization/store-scope.service";
import { CurrentUser, Permissions } from "@common/decorators/auth.decorator";
import { AuthUser } from "@common/types/auth.type";
import { pageParams } from "@common/utils/helpers.util";
import { ParseBigIntPipe } from "@core/http/pipes/parse-bigint.pipe";
import {
    ActivityQuery,
    CreateTeamMemberDto,
    HoldDto,
    ReleaseHoldDto,
    RejectDto,
    SetStatusDto,
    StoreTeamQuery,
    UpdateStaffDto,
} from "../../admin/users/users.dto";
import { UsersService } from "@modules/users/users.service";
import {
    ApiHoldUser,
    ApiReleaseUser,
    ApiWorkHistory,
    ApiStoreTeamApprove,
    ApiStoreTeamCreate,
    ApiStoreTeamGet,
    ApiStoreTeamList,
    ApiStoreTeamPending,
    ApiStoreTeamReject,
    ApiStoreTeamStatus,
    ApiStoreTeamUpdate,
} from "../../admin/users/users.swagger";
import { Body, Get, HttpCode, Param, Patch, Post, Query } from "@nestjs/common";
import { StoreController } from "../store-controller.decorator";

/** Store manager: own team (staff + delivery partners). */
@StoreController("team", "Team", {
    managerOnly: true,
    forbidden:
        "Not STORE_MANAGER, missing permission, or the member is not in your store",
})
export class StoreTeamController {
    constructor(
        private readonly users: UsersService,
        private readonly storeScope: StoreScopeService,
    ) {}

    @Permissions(P.USER_READ)
    @ApiStoreTeamList()
    @Get()
    list(@CurrentUser() user: AuthUser, @Query() query: StoreTeamQuery) {
        return this.users.team(this.storeScope.scope(user), {
            ...pageParams(query),
            role: query.role,
        });
    }

    // Must stay ABOVE ":id" routes.
    @Permissions(P.USER_READ)
    @ApiStoreTeamPending()
    @Get("pending")
    pending(@CurrentUser() user: AuthUser, @Query() query: StoreTeamQuery) {
        return this.users.pendingTeam(this.storeScope.scope(user), {
            ...pageParams(query),
            role: query.role,
        });
    }

    @Permissions(P.USER_CREATE)
    @ApiStoreTeamCreate()
    @Post()
    create(@CurrentUser() user: AuthUser, @Body() dto: CreateTeamMemberDto) {
        return this.users.createMember(this.storeScope.scope(user), dto, user);
    }

    @Permissions(P.USER_READ)
    @ApiStoreTeamGet()
    @Get(":id")
    get(
        @CurrentUser() user: AuthUser,
        @Param("id", ParseBigIntPipe) id: bigint,
    ) {
        return this.users.teamMember(this.storeScope.scope(user), id);
    }

    @Permissions(P.USER_UPDATE)
    @ApiStoreTeamUpdate()
    @Patch(":id")
    update(
        @CurrentUser() user: AuthUser,
        @Param("id", ParseBigIntPipe) id: bigint,
        @Body() dto: UpdateStaffDto,
    ) {
        return this.users.updateStaff(
            this.storeScope.scope(user),
            id,
            dto,
            user,
        );
    }

    @Permissions(P.USER_APPROVE)
    @ApiStoreTeamApprove()
    @Post(":id/approve")
    @HttpCode(200)
    approve(
        @Param("id", ParseBigIntPipe) id: bigint,
        @CurrentUser() user: AuthUser,
    ) {
        return this.users.approve(id, user);
    }

    @Permissions(P.USER_APPROVE)
    @ApiStoreTeamReject()
    @Post(":id/reject")
    @HttpCode(200)
    reject(
        @Param("id", ParseBigIntPipe) id: bigint,
        @Body() dto: RejectDto,
        @CurrentUser() user: AuthUser,
    ) {
        return this.users.reject(id, dto.reason, user);
    }

    @Permissions(P.USER_APPROVE)
    @ApiStoreTeamStatus()
    @Patch(":id/status")
    setStatus(
        @Param("id", ParseBigIntPipe) id: bigint,
        @Body() dto: SetStatusDto,
        @CurrentUser() user: AuthUser,
    ) {
        return this.users.setStatus(id, dto.status, dto.reason, user);
    }

    @Permissions(P.USER_HOLD)
    @ApiHoldUser("store")
    @Post(":id/hold")
    @HttpCode(200)
    hold(
        @Param("id", ParseBigIntPipe) id: bigint,
        @Body() dto: HoldDto,
        @CurrentUser() user: AuthUser,
    ) {
        return this.users.hold(id, dto, user);
    }

    @Permissions(P.USER_HOLD)
    @ApiReleaseUser("store")
    @Post(":id/release")
    @HttpCode(200)
    release(
        @Param("id", ParseBigIntPipe) id: bigint,
        @Body() dto: ReleaseHoldDto,
        @CurrentUser() user: AuthUser,
    ) {
        return this.users.release(id, dto.note, user);
    }

    @Permissions(P.USER_READ)
    @ApiWorkHistory("member")
    @Get(":id/activity")
    async activity(
        @Param("id", ParseBigIntPipe) id: bigint,
        @Query() q: ActivityQuery,
        @CurrentUser() user: AuthUser,
    ) {
        await this.users.teamMember(this.storeScope.scope(user), id);
        return this.users.activity(id, q);
    }
}
