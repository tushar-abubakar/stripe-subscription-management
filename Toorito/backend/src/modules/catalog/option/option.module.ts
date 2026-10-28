import { OptionService } from "./option.service";
import { CatalogSharedModule } from "../shared/catalog-shared.module";
import { MediaModule } from "@modules/media/media.module";
import { Module } from "@nestjs/common";

@Module({
    imports: [CatalogSharedModule, MediaModule],
    providers: [OptionService],
    exports: [OptionService],
})
export class OptionModule {}
