import { PageQueryDto } from "@common/dto/page-query.dto";
import { CurrentUser } from "@common/decorators/auth.decorator";
import { AuthUser } from "@common/types/auth.type";
import { ParseBigIntPipe } from "@core/http/pipes/parse-bigint.pipe";
import { CreateReturnDto } from "../../admin/approvals/approvals.dto";
import {
    ApiCreateReturn,
    ApiMyReturns,
} from "../../admin/approvals/approvals.swagger";
import { ReturnsService } from "@modules/approvals/returns.service";
import { Body, Get, HttpCode, Param, Post, Query } from "@nestjs/common";
import { AppController } from "../app-controller.decorator";

/** Customer: return / exchange delivered items. */
@AppController("", "Returns", "customer")
export class AppReturnsController {
    constructor(private readonly returns: ReturnsService) {}

    @ApiCreateReturn()
    @Post("orders/:id/returns")
    @HttpCode(200)
    create(
        @CurrentUser() user: AuthUser,
        @Param("id", ParseBigIntPipe) id: bigint,
        @Body() dto: CreateReturnDto,
    ) {
        return this.returns.create(user, id, dto);
    }

    @ApiMyReturns()
    @Get("returns")
    mine(@CurrentUser() user: AuthUser, @Query() q: PageQueryDto) {
        return this.returns.mine(user, q);
    }
}
