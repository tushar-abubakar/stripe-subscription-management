import { Module } from "@nestjs/common";
import { AppConfigService } from "./app-config.service";

/** Client start-up configuration. HTTP lives in src/api/{public,admin,store,partner}. */
@Module({
    providers: [AppConfigService],
    exports: [AppConfigService],
})
export class AppConfigModule {}
