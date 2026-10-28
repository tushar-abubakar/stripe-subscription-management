import { ParseBigIntPipe } from "@core/http/pipes/parse-bigint.pipe";
import { BundlesService } from "@modules/catalog/bundles/bundles.service";
import { Get, Query } from "@nestjs/common";
import { ApiOperation } from "@nestjs/swagger";
import { I18nLang } from "nestjs-i18n";
import { PublicController } from "../public-controller.decorator";

@PublicController("catalog/bundles", "Catalog")
export class PublicBundlesController {
    constructor(private readonly bundles: BundlesService) {}

    @ApiOperation({ security: [] })
    @Get()
    list(
        @Query("storeId", ParseBigIntPipe)
        storeId: bigint,
        @I18nLang() lang: string,
    ) {
        return this.bundles.storefront(storeId, lang);
    }
}
