import { MediaModule } from "@modules/media/media.module";
import { Module } from "@nestjs/common";
import { CatalogSharedModule } from "../shared/catalog-shared.module";
import { CategoryGroupService } from "./category-group.service";

/** Category groups (display grouping of categories). HTTP lives in src/api/admin/catalog and src/api/public/catalog. */
@Module({
    imports: [CatalogSharedModule, MediaModule],
    providers: [CategoryGroupService],
    exports: [CategoryGroupService],
})
export class CategoryGroupModule {}
