import { BrandModule } from "../brand/brand.module";
import { CategoryModule } from "../category/category.module";
import { OptionModule } from "../option/option.module";
import { ProductService } from "./product.service";
import { CatalogSharedModule } from "../shared/catalog-shared.module";
import { InventoryModule } from "@modules/inventory/inventory.module";
import { MediaModule } from "@modules/media/media.module";
import { Module } from "@nestjs/common";

@Module({
    imports: [
        CatalogSharedModule,
        MediaModule,
        CategoryModule,
        BrandModule,
        OptionModule,
        InventoryModule,
    ],
    providers: [ProductService],
    exports: [ProductService],
})
export class ProductModule {}
