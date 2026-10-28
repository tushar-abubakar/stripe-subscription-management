import { BrandService } from "./brand.service";
import { CatalogSharedModule } from "../shared/catalog-shared.module";
import { MediaModule } from "@modules/media/media.module";
import { Module } from "@nestjs/common";

@Module({
    imports: [CatalogSharedModule, MediaModule],
    providers: [BrandService],
    exports: [BrandService],
})
export class BrandModule {}
