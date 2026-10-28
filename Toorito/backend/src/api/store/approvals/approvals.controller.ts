import { P } from "@common/authorization/permissions";
import { StoreScopeService } from "@common/authorization/store-scope.service";
import { CurrentUser, Permissions } from "@common/decorators/auth.decorator";
import { AuthUser } from "@common/types/auth.type";
import { ParseBigIntPipe } from "@core/http/pipes/parse-bigint.pipe";
import {
    DecisionDto,
    RejectDecisionDto,
    StoreApprovalListQuery,
} from "../../admin/approvals/approvals.dto";
import { ApprovalsService } from "@modules/approvals/approvals.service";
import {
    ApiApprovalGet,
    ApiApprovalList,
    ApiApprovalSummary,
    ApiApprove,
    ApiCancelApproval,
    ApiReject,
} from "../../admin/approvals/approvals.swagger";
import { Body, Get, HttpCode, Param, Post, Query } from "@nestjs/common";
import { StoreController } from "../store-controller.decorator";

/** Store manager: decide returns / exchanges; follow what was sent to the admin. */
@Permissions(P.APPROVAL_READ)
@StoreController("approvals", "Approvals", {
    managerOnly: true,
    forbidden:
        "Not STORE_MANAGER or `approval.read` / `approval.manage` missing",
})
export class StoreApprovalsController {
    constructor(
        private readonly approvals: ApprovalsService,
        private readonly storeScope: StoreScopeService,
    ) {}

    @ApiApprovalList("store")
    @Get()
    list(@CurrentUser() user: AuthUser, @Query() q: StoreApprovalListQuery) {
        return this.approvals.storeList(this.storeScope.scope(user), q);
    }

    @ApiApprovalSummary()
    @Get("summary")
    summary(@CurrentUser() user: AuthUser) {
        return this.approvals.summary({ storeId: this.storeScope.scope(user) });
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

    @ApiCancelApproval()
    @Post(":id/cancel")
    @HttpCode(200)
    cancel(
        @CurrentUser() user: AuthUser,
        @Param("id", ParseBigIntPipe) id: bigint,
    ) {
        return this.approvals.cancel(id, user);
    }
}
