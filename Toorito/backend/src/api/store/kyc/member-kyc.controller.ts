import { P } from "@common/authorization/permissions";
import { StoreScopeService } from "@common/authorization/store-scope.service";
import { CurrentUser, Permissions } from "@common/decorators/auth.decorator";
import { AuthUser } from "@common/types/auth.type";
import { ParseBigIntPipe } from "@core/http/pipes/parse-bigint.pipe";
import { KycDocDto, KycSubmitDto } from "./kyc.dto";
import { KycService } from "@modules/kyc/kyc.service";
import {
    ApiAddMemberKyc,
    ApiDeleteMemberKyc,
    ApiMemberKyc,
    ApiSubmitMemberKyc,
} from "./kyc.swagger";
import { Body, Delete, Get, HttpCode, Param, Post } from "@nestjs/common";
import { StoreController } from "../store-controller.decorator";

/**
 * Store manager: KYC of a member being onboarded (drafts — preview, replace,
 * delete, then submit = sign-up sent to the admin). Locked after that.
 */
@Permissions(P.USER_CREATE)
@StoreController("team/:userId/kyc", "Team KYC", {
    managerOnly: true,
    forbidden: "Not STORE_MANAGER or `user.create` missing",
})
export class StoreMemberKycController {
    constructor(
        private readonly kyc: KycService,
        private readonly storeScope: StoreScopeService,
    ) {}

    @ApiMemberKyc()
    @Get()
    view(
        @CurrentUser() user: AuthUser,
        @Param("userId", ParseBigIntPipe) userId: bigint,
    ) {
        return this.kyc.memberView(this.storeScope.scope(user), userId);
    }

    @ApiAddMemberKyc()
    @Post()
    @HttpCode(200)
    add(
        @CurrentUser() user: AuthUser,
        @Param("userId", ParseBigIntPipe) userId: bigint,
        @Body() dto: KycDocDto,
    ) {
        return this.kyc.memberAdd(
            this.storeScope.scope(user),
            userId,
            user,
            dto,
        );
    }

    @ApiSubmitMemberKyc()
    @Post("submit")
    @HttpCode(200)
    submit(
        @CurrentUser() user: AuthUser,
        @Param("userId", ParseBigIntPipe) userId: bigint,
        @Body() dto: KycSubmitDto,
    ) {
        return this.kyc.memberSubmit(
            this.storeScope.scope(user),
            userId,
            user,
            dto?.note,
        );
    }

    @ApiDeleteMemberKyc()
    @Delete(":docId")
    remove(
        @CurrentUser() user: AuthUser,
        @Param("userId", ParseBigIntPipe) userId: bigint,
        @Param("docId", ParseBigIntPipe) docId: bigint,
    ) {
        return this.kyc.memberDelete(
            this.storeScope.scope(user),
            userId,
            docId,
        );
    }
}
