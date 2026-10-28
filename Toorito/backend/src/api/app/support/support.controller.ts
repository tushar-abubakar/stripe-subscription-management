import { CurrentUser } from "@common/decorators/auth.decorator";
import { AuthUser } from "@common/types/auth.type";
import { ParseBigIntPipe } from "@core/http/pipes/parse-bigint.pipe";
import {
    CreateTicketDto,
    MessageDto,
    MyTicketsQuery,
} from "../../admin/support/support.dto";
import { SupportService } from "@modules/support/support.service";
import { Body, Get, HttpCode, Param, Post, Query } from "@nestjs/common";
import { AppController } from "../app-controller.decorator";

@AppController("support/tickets", "Support", "user")
export class AppSupportController {
    constructor(private readonly support: SupportService) {}

    @Post()
    create(@CurrentUser() user: AuthUser, @Body() dto: CreateTicketDto) {
        return this.support.create(user, dto);
    }

    @Get()
    mine(@CurrentUser() user: AuthUser, @Query() query: MyTicketsQuery) {
        return this.support.mine(user, query);
    }

    @Get(":id")
    get(
        @CurrentUser() user: AuthUser,
        @Param("id", ParseBigIntPipe) id: bigint,
    ) {
        return this.support.thread(user, id, false);
    }

    @Post(":id/messages")
    @HttpCode(200)
    reply(
        @CurrentUser() user: AuthUser,
        @Param("id", ParseBigIntPipe) id: bigint,
        @Body() dto: MessageDto,
    ) {
        return this.support.reply(user, id, dto, false);
    }
}
