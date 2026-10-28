import { P } from "@common/authorization/permissions";
import { StoreScopeService } from "@common/authorization/store-scope.service";
import { CurrentUser, Permissions } from "@common/decorators/auth.decorator";
import { AuthUser } from "@common/types/auth.type";
import { ParseBigIntPipe } from "@core/http/pipes/parse-bigint.pipe";
import { KycForwardDto, KycListQuery } from "./kyc.dto";
import { KycService } from "@modules/kyc/kyc.service";
import { ApiStoreKycForward, ApiStoreKycList } from "./kyc.swagger";
import { Body, Get, HttpCode, Param, Post, Query } from "@nestjs/common";
import { StoreController } from "../store-controller.decorator";

/** Store manager: review the team's documents (metadata only) and forward them to the admin. */
@Permissions(P.KYC_REVIEW)
@StoreController("kyc", "KYC review", {
    managerOnly: true,
    forbidden: "Not STORE_MANAGER or `kyc.review` missing",
})
export class StoreKycController {
    constructor(
        private readonly kyc: KycService,
        private readonly storeScope: StoreScopeService,
    ) {}

    @ApiStoreKycList()
    @Get()
    list(@CurrentUser() user: AuthUser, @Query() q: KycListQuery) {
        return this.kyc.storeList(this.storeScope.scope(user), q);
    }

    @ApiStoreKycForward()
    @Post(":id/forward")
    @HttpCode(200)
    forward(
        @CurrentUser() user: AuthUser,
        @Param("id", ParseBigIntPipe) id: bigint,
        @Body() dto: KycForwardDto,
    ) {
        return this.kyc.forward(
            user,
            this.storeScope.scope(user),
            id,
            dto.recommendation,
            dto.note,
        );
    }
}
