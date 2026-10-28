import { CatalogCacheService } from "./catalog-cache.service";
import { CatalogMediaValidator } from "./catalog-media.validator";
import { Module } from "@nestjs/common";

/**
 * Cache + media-validation helpers shared by the category, brand and
 * product services. Providers are instantiated once and reused by every
 * module that imports this one.
 */
@Module({
    providers: [CatalogCacheService, CatalogMediaValidator],
    exports: [CatalogCacheService, CatalogMediaValidator],
})
export class CatalogSharedModule {}
