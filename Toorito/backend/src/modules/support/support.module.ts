import {
    NotificationsModule,
} from "@modules/notifications/notifications.module";
import { SupportService } from "./support.service";
import { Module } from "@nestjs/common";

@Module({
    imports: [NotificationsModule],
    providers: [SupportService],
    exports: [SupportService],
})
export class SupportModule {}
