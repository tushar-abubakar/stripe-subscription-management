import { AppConfigService } from "@modules/app-config/app-config.service";
import { Get } from "@nestjs/common";
import { ApiPartnerAppConfig } from "../../public/app-config.swagger";
import { PartnerController } from "../partner-controller.decorator";

/** Start-up configuration of the Delivery partner app. */
@PartnerController("config", "App config")
export class PartnerAppConfigController {
    constructor(private readonly appConfig: AppConfigService) {}

    @ApiPartnerAppConfig()
    @Get()
    get() {
        return this.appConfig.deliveryConfig();
    }
}
