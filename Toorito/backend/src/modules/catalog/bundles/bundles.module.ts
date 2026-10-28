import { CartModule } from "@modules/cart/cart.module";
import { BundlesService } from "./bundles.service";
import { MediaModule } from "@modules/media/media.module";
import { Module } from "@nestjs/common";

@Module({
    imports: [CartModule, MediaModule],
    providers: [BundlesService],
    exports: [BundlesService],
})
export class BundlesModule {}
