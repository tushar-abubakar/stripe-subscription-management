import { P } from "@common/authorization/permissions";
import { CurrentUser, Permissions } from "@common/decorators/auth.decorator";
import { AuthUser } from "@common/types/auth.type";
import { ParseBigIntPipe } from "@core/http/pipes/parse-bigint.pipe";
import {
    AdminApprovalListQuery,
    DecisionDto,
    RejectDecisionDto,
} from "./approvals.dto";
import { ApprovalsService } from "@modules/approvals/approvals.service";
import {
    ApiApprovalGet,
    ApiApprovalList,
    ApiApprovalSummary,
    ApiApprove,
    ApiReject,
} from "./approvals.swagger";
import { Body, Get, HttpCode, Param, Post, Query } from "@nestjs/common";
import { AdminController } from "../admin-controller.decorator";

/** Admin: every ADMIN-level decision (onboarding, KYC, barcodes, GRN edits) + oversight of store-level ones. */
@Permissions(P.APPROVAL_READ)
@AdminController(
    "approvals",
    "Approvals",
    "Not ADMIN / SUPER_ADMIN or `approval.read` / `approval.manage` missing",
)
export class AdminApprovalsController {
    constructor(private readonly approvals: ApprovalsService) {}

    @ApiApprovalList("admin")
    @Get()
    list(@Query() q: AdminApprovalListQuery) {
        return this.approvals.adminList(q);
    }

    @ApiApprovalSummary()
    @Get("summary")
    summary() {
        return this.approvals.summary({});
    }

    @ApiApprovalGet()
    @Get(":id")
    get(
        @CurrentUser() user: AuthUser,
        @Param("id", ParseBigIntPipe) id: bigint,
    ) {
        return this.approvals.get(id, user);
    }

    @Permissions(P.APPROVAL_MANAGE)
    @ApiApprove()
    @Post(":id/approve")
    @HttpCode(200)
    approve(
        @CurrentUser() user: AuthUser,
        @Param("id", ParseBigIntPipe) id: bigint,
        @Body() dto: DecisionDto,
    ) {
        return this.approvals.decide(id, user, true, dto);
    }

    @Permissions(P.APPROVAL_MANAGE)
    @ApiReject()
    @Post(":id/reject")
    @HttpCode(200)
    reject(
        @CurrentUser() user: AuthUser,
        @Param("id", ParseBigIntPipe) id: bigint,
        @Body() dto: RejectDecisionDto,
    ) {
        return this.approvals.decide(id, user, false, dto);
    }
}
