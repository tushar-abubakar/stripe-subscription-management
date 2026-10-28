import { P } from "@common/authorization/permissions";
import { CurrentUser, Permissions } from "@common/decorators/auth.decorator";
import { AuthUser } from "@common/types/auth.type";
import { ParseBigIntPipe } from "@core/http/pipes/parse-bigint.pipe";
import {
    AdminSupportSummaryQuery,
    ResolveTicketDto,
    StaffMessageDto,
    TicketQueueQuery,
    UpdateTicketDto,
} from "./support.dto";
import { SupportService } from "@modules/support/support.service";
import {
    ApiSupportSummary,
    ApiTicketQueue,
    ApiTicketReply,
    ApiTicketResolve,
    ApiTicketThread,
    ApiTicketUpdate,
} from "./support.swagger";
import { Body, Get, HttpCode, Param, Patch, Post, Query } from "@nestjs/common";
import { AdminController } from "../admin-controller.decorator";

/** Admin: complaints of every store. Static routes stay above `:id`. */
@AdminController("support", "Support")
export class AdminSupportController {
    constructor(private readonly support: SupportService) {}

    @Permissions(P.SUPPORT_MANAGE)
    @ApiSupportSummary(true)
    @Get("summary")
    summary(@Query() query: AdminSupportSummaryQuery) {
        return this.support.summary(
            query.storeId ? BigInt(query.storeId) : null,
            query,
        );
    }

    @Permissions(P.SUPPORT_MANAGE)
    @ApiTicketQueue(true)
    @Get("tickets")
    queue(@CurrentUser() user: AuthUser, @Query() query: TicketQueueQuery) {
        return this.support.queue(user, query);
    }

    @Permissions(P.SUPPORT_MANAGE)
    @ApiTicketThread()
    @Get("tickets/:id")
    get(
        @CurrentUser() user: AuthUser,
        @Param("id", ParseBigIntPipe) id: bigint,
    ) {
        return this.support.thread(user, id, true);
    }

    @Permissions(P.SUPPORT_MANAGE)
    @ApiTicketReply()
    @Post("tickets/:id/messages")
    @HttpCode(200)
    reply(
        @CurrentUser() user: AuthUser,
        @Param("id", ParseBigIntPipe) id: bigint,
        @Body() dto: StaffMessageDto,
    ) {
        return this.support.reply(user, id, dto, true);
    }

    @Permissions(P.SUPPORT_MANAGE)
    @ApiTicketResolve()
    @Post("tickets/:id/resolve")
    @HttpCode(200)
    resolve(
        @CurrentUser() user: AuthUser,
        @Param("id", ParseBigIntPipe) id: bigint,
        @Body() dto: ResolveTicketDto,
    ) {
        return this.support.resolve(user, id, dto);
    }

    @Permissions(P.SUPPORT_MANAGE)
    @ApiTicketUpdate()
    @Patch("tickets/:id")
    update(
        @CurrentUser() user: AuthUser,
        @Param("id", ParseBigIntPipe) id: bigint,
        @Body() dto: UpdateTicketDto,
    ) {
        return this.support.update(user, id, dto);
    }
}
