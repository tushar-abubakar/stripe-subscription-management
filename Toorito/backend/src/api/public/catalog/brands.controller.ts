import { BrandService } from "@modules/catalog/brand/brand.service";
import { ApiStorefrontBrandList } from "../../admin/catalog/brand.swagger";
import { Get } from "@nestjs/common";
import { I18nLang } from "nestjs-i18n";
import { PublicController } from "../public-controller.decorator";

/** Public storefront: active brands (customers + guests). */
@PublicController("catalog/brands", "Catalog")
export class PublicBrandsController {
    constructor(private readonly brands: BrandService) {}

    @ApiStorefrontBrandList()
    @Get()
    list(@I18nLang() lang: string) {
        return this.brands.list(lang);
    }
}
