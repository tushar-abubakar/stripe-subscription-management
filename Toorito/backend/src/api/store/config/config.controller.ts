import { AppConfigService } from "@modules/app-config/app-config.service";
import { Get } from "@nestjs/common";
import { ApiStoreAppConfig } from "../../public/app-config.swagger";
import { StoreController } from "../store-controller.decorator";

/** Start-up configuration of the Store app. */
@StoreController("config", "App config")
export class StoreAppConfigController {
    constructor(private readonly appConfig: AppConfigService) {}

    @ApiStoreAppConfig()
    @Get()
    get() {
        return this.appConfig.storeConfig();
    }
}
