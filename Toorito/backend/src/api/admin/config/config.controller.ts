import { AppConfigService } from "@modules/app-config/app-config.service";
import { Get } from "@nestjs/common";
import { ApiAdminAppConfig } from "../../public/app-config.swagger";
import { AdminController } from "../admin-controller.decorator";

/** Start-up configuration of the Admin panel. */
@AdminController("config", "App config")
export class AdminAppConfigController {
    constructor(private readonly appConfig: AppConfigService) {}

    @ApiAdminAppConfig()
    @Get()
    get() {
        return this.appConfig.adminConfig();
    }
}
