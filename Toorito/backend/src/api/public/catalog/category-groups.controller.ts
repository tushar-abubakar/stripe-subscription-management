import { CategoryGroupService } from "@modules/catalog/category-group/category-group.service";
import { Get, Param } from "@nestjs/common";
import { I18nLang } from "nestjs-i18n";
import {
    ApiPublicCategoryGroup,
    ApiPublicCategoryGroups,
} from "../../admin/catalog/category-group.swagger";
import { PublicController } from "../public-controller.decorator";

/** Open catalogue: category groups ("Vegetables & Fruits" → its categories). */
@PublicController("catalog/category-groups", "Catalog")
export class PublicCategoryGroupsController {
    constructor(private readonly groups: CategoryGroupService) {}

    @ApiPublicCategoryGroups()
    @Get()
    list(@I18nLang() lang: string) {
        return this.groups.storefront(lang);
    }

    @ApiPublicCategoryGroup()
    @Get(":slug")
    get(@Param("slug") slug: string, @I18nLang() lang: string) {
        return this.groups.storefrontOne(slug, lang);
    }
}
