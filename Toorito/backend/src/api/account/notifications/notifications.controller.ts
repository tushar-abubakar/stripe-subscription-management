import { CurrentUser } from "@common/decorators/auth.decorator";
import { PageQueryDto } from "@common/dto/page-query.dto";
import { AuthUser } from "@common/types/auth.type";
import { ParseBigIntPipe } from "@core/http/pipes/parse-bigint.pipe";
import { Get, HttpCode, Param, Post, Query } from "@nestjs/common";
import { AccountController } from "../account-controller.decorator";
import { NotificationsService } from "@modules/notifications/notifications.service";

@AccountController("notifications", "Notifications")
export class AccountNotificationsController {
    constructor(private readonly notifications: NotificationsService) {}

    @Get()
    list(@CurrentUser() user: AuthUser, @Query() query: PageQueryDto) {
        return this.notifications.list(user.id, query);
    }
    @Get("unread-count")
    async unread(@CurrentUser() user: AuthUser) {
        return { count: await this.notifications.unread(user.id) };
    }

    @Post("read-all")
    @HttpCode(200)
    readAll(@CurrentUser() user: AuthUser) {
        return this.notifications.read(user.id);
    }

    @Post(":id/read")
    @HttpCode(200)
    read(
        @CurrentUser() user: AuthUser,
        @Param("id", ParseBigIntPipe) id: bigint,
    ) {
        return this.notifications.read(user.id, id);
    }
}
