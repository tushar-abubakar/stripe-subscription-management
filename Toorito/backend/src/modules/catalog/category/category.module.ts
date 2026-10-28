import { CategoryService } from "./category.service";
import { CatalogSharedModule } from "../shared/catalog-shared.module";
import { MediaModule } from "@modules/media/media.module";
import { Module } from "@nestjs/common";

/**
 * Category feature module.
 *
 * Exports `CategoryService` so `CatalogModule` (products) can validate a
 * product's category and expand category descendants without depending on
 * the product service.
 */
@Module({
    imports: [CatalogSharedModule, MediaModule],
    providers: [CategoryService],
    exports: [CategoryService],
})
export class CategoryModule {}
