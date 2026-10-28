import { CurrentUser } from "@common/decorators/auth.decorator";
import { PageQueryDto } from "@common/dto/page-query.dto";
import { AuthUser } from "@common/types/auth.type";
import { ParseBigIntPipe } from "@core/http/pipes/parse-bigint.pipe";
import { CancelDto, CheckoutDto, RateDto } from "./orders.dto";
import { OrdersService } from "@modules/orders/orders.service";
import { Body, Get, HttpCode, Param, Post, Query } from "@nestjs/common";
import { I18nLang } from "nestjs-i18n";
import { AppController } from "../app-controller.decorator";

@AppController("orders", "Orders", "customer")
export class AppOrdersController {
    constructor(private readonly orders: OrdersService) {}

    @Post()
    checkout(
        @CurrentUser() user: AuthUser,
        @Body() dto: CheckoutDto,
        @I18nLang() lang: string,
    ) {
        return this.orders.checkout(user, dto, lang);
    }

    @Get()
    list(@CurrentUser() user: AuthUser, @Query() query: PageQueryDto) {
        return this.orders.customerList(user.id, query);
    }

    @Get(":id")
    get(
        @CurrentUser() user: AuthUser,
        @Param("id", ParseBigIntPipe) id: bigint,
    ) {
        return this.orders.customerGet(user.id, id);
    }

    @Get(":id/track")
    track(
        @CurrentUser() user: AuthUser,
        @Param("id", ParseBigIntPipe) id: bigint,
    ) {
        return this.orders.track(user.id, id);
    }

    @Post(":id/cancel")
    @HttpCode(200)
    cancel(
        @CurrentUser() user: AuthUser,
        @Param("id", ParseBigIntPipe) id: bigint,
        @Body() dto: CancelDto,
    ) {
        return this.orders.customerCancel(user.id, id, dto.reason);
    }

    @Post(":id/rate")
    @HttpCode(200)
    rate(
        @CurrentUser() user: AuthUser,
        @Param("id", ParseBigIntPipe) id: bigint,
        @Body() dto: RateDto,
    ) {
        return this.orders.rate(user.id, id, dto);
    }
}
