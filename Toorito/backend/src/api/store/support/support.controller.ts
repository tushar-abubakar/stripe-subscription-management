import { P } from "@common/authorization/permissions";
import { StoreScopeService } from "@common/authorization/store-scope.service";
import {
    Capability,
    CurrentUser,
    Permissions,
    Roles,
} from "@common/decorators/auth.decorator";
import { AuthUser } from "@common/types/auth.type";
import { ParseBigIntPipe } from "@core/http/pipes/parse-bigint.pipe";
import {
    EscalateTicketDto,
    ResolveTicketDto,
    StaffMessageDto,
    StoreTicketQueueQuery,
    SupportSummaryQuery,
    UpdateTicketDto,
} from "../../admin/support/support.dto";
import { SupportService } from "@modules/support/support.service";
import {
    ApiSupportSummary,
    ApiTicketEscalate,
    ApiTicketQueue,
    ApiTicketReply,
    ApiTicketResolve,
    ApiTicketThread,
    ApiTicketUpdate,
} from "../../admin/support/support.swagger";
import { Body, Get, HttpCode, Param, Patch, Post, Query } from "@nestjs/common";
import { UserRole } from "@prisma-client/enums";
import { StoreController } from "../store-controller.decorator";

/**
 * Store-scoped complaint queue (separate from the admin queue). Managers and
 * staff with the SUPPORT duty work tickets; assigning / re-prioritising and
 * escalating to the admin team stay with the manager.
 */
@StoreController("support", "Support")
export class StoreSupportController {
    constructor(
        private readonly support: SupportService,
        private readonly storeScope: StoreScopeService,
    ) {}

    @Permissions(P.SUPPORT_MANAGE)
    @ApiSupportSummary()
    @Get("summary")
    summary(
        @CurrentUser() user: AuthUser,
        @Query() query: SupportSummaryQuery,
    ) {
        return this.support.summary(this.storeScope.scope(user), query);
    }

    @Permissions(P.SUPPORT_MANAGE)
    @ApiTicketQueue()
    @Get("tickets")
    queue(
        @CurrentUser() user: AuthUser,
        @Query() query: StoreTicketQueueQuery,
    ) {
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

    @Capability("SUPPORT")
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

    @Capability("SUPPORT")
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

    @Roles(UserRole.STORE_MANAGER)
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

    @Roles(UserRole.STORE_MANAGER)
    @Permissions(P.SUPPORT_MANAGE)
    @ApiTicketEscalate()
    @Post("tickets/:id/escalate")
    @HttpCode(200)
    escalate(
        @CurrentUser() user: AuthUser,
        @Param("id", ParseBigIntPipe) id: bigint,
        @Body() dto: EscalateTicketDto,
    ) {
        return this.support.escalate(user, id, dto.note);
    }
}
