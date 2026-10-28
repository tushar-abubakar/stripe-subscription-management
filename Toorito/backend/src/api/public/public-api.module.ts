import { AppConfigModule } from "@modules/app-config/app-config.module";
import { BrandModule } from "@modules/catalog/brand/brand.module";
import { BundlesModule } from "@modules/catalog/bundles/bundles.module";
import { CategoryGroupModule } from "@modules/catalog/category-group/category-group.module";
import { CategoryModule } from "@modules/catalog/category/category.module";
import { PaymentsModule } from "@modules/payments/payments.module";
import { ProductModule } from "@modules/catalog/product/product.module";
import { Module } from "@nestjs/common";
import { PublicAppConfigController } from "./app-config";
import { PublicBrandsController } from "./catalog/brands.controller";
import { PublicBundlesController } from "./catalog/bundles.controller";
import { PublicCategoriesController } from "./catalog/categories.controller";
import { PublicCategoryGroupsController } from "./catalog/category-groups.controller";
import { PublicProductsController } from "./catalog/products.controller";
import { PublicHealthController } from "./health";
import { PublicWebhooksController } from "./webhooks";

/** Open endpoints: health, webhooks, app config, open catalogue (prefix /public via RouterModule). */
@Module({
    imports: [AppConfigModule, BrandModule, BundlesModule, CategoryGroupModule, CategoryModule, PaymentsModule, ProductModule],
    controllers: [
        PublicAppConfigController,
        PublicBrandsController,
        PublicBundlesController,
        PublicCategoriesController,
        PublicCategoryGroupsController,
        PublicProductsController,
        PublicHealthController,
        PublicWebhooksController,
    ],
})
export class PublicApiModule {}
