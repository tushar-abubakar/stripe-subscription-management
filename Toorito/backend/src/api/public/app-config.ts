import { AppConfigService } from "@modules/app-config/app-config.service";
import { Get } from "@nestjs/common";
import { ApiPublicAppConfig } from "./app-config.swagger";
import { PublicController } from "./public-controller.decorator";

/** Start-up configuration of every client app (no token needed). */
@PublicController("config", "App config")
export class PublicAppConfigController {
    constructor(private readonly appConfig: AppConfigService) {}

    @ApiPublicAppConfig()
    @Get()
    get() {
        return this.appConfig.publicConfig();
    }
}
