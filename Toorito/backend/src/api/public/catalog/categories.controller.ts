import { CategoryService } from "@modules/catalog/category/category.service";
import { ApiCategoryTree } from "../../admin/catalog/category.swagger";
import { Get } from "@nestjs/common";
import { I18nLang } from "nestjs-i18n";
import { PublicController } from "../public-controller.decorator";

/** Public storefront: active category tree (customers + guests). */
@PublicController("catalog/categories", "Catalog")
export class PublicCategoriesController {
    constructor(private readonly categories: CategoryService) {}

    @ApiCategoryTree()
    @Get()
    tree(@I18nLang() lang: string) {
        return this.categories.tree(lang);
    }
}
