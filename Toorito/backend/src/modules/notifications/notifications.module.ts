import { Module } from "@nestjs/common";
import { NotificationsService } from "./notifications.service";

/** In-app notifications. HTTP lives in src/api/account/notifications. */
@Module({
    providers: [NotificationsService],
    exports: [NotificationsService],
})
export class NotificationsModule {}
