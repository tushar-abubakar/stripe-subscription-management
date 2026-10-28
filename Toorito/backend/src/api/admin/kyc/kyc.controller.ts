import { P } from "@common/authorization/permissions";
import { CurrentUser, Permissions } from "@common/decorators/auth.decorator";
import { AuthUser } from "@common/types/auth.type";
import { ParseBigIntPipe } from "@core/http/pipes/parse-bigint.pipe";
import { AdminKycListQuery, KycReviewDto } from "../../store/kyc/kyc.dto";
import { KycService } from "@modules/kyc/kyc.service";
import {
    ApiAdminKycList,
    ApiAdminKycReview,
} from "../../store/kyc/kyc.swagger";
import { Body, Get, HttpCode, Param, Post, Query } from "@nestjs/common";
import { AdminController } from "../admin-controller.decorator";

/** Admin: final KYC decisions. */
@Permissions(P.KYC_REVIEW)
@AdminController(
    "kyc",
    "KYC review",
    "Not ADMIN / SUPER_ADMIN or `kyc.review` missing",
)
export class AdminKycController {
    constructor(private readonly kyc: KycService) {}

    @ApiAdminKycList()
    @Get()
    list(@Query() q: AdminKycListQuery) {
        return this.kyc.adminList(q);
    }

    @ApiAdminKycReview()
    @Post(":id/review")
    @HttpCode(200)
    review(
        @CurrentUser() user: AuthUser,
        @Param("id", ParseBigIntPipe) id: bigint,
        @Body() dto: KycReviewDto,
    ) {
        return this.kyc.review(user, id, dto.approve, dto.reason);
    }
}
