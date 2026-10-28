import { CurrentUser } from "@common/decorators/auth.decorator";
import { AuthUser } from "@common/types/auth.type";
import { ParseBigIntPipe } from "@core/http/pipes/parse-bigint.pipe";
import { ApprovalListQuery } from "../../admin/approvals/approvals.dto";
import { ApprovalsService } from "@modules/approvals/approvals.service";
import {
    ApiApprovalGet,
    ApiApprovalList,
    ApiCancelApproval,
} from "../../admin/approvals/approvals.swagger";
import { Get, HttpCode, Param, Post, Query } from "@nestjs/common";
import { AccountController } from "../account-controller.decorator";

/** Anyone signed in: the requests they opened (KYC removal, returns, …). */
@AccountController("approvals", "My approval requests")
export class AccountApprovalsController {
    constructor(private readonly approvals: ApprovalsService) {}

    @ApiApprovalList("me")
    @Get()
    list(@CurrentUser() user: AuthUser, @Query() q: ApprovalListQuery) {
        return this.approvals.mine(user, q);
    }

    @ApiApprovalGet()
    @Get(":id")
    get(
        @CurrentUser() user: AuthUser,
        @Param("id", ParseBigIntPipe) id: bigint,
    ) {
        return this.approvals.get(id, user);
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
