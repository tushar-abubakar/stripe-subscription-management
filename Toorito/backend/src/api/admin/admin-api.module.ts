import { AdminModule } from "@modules/admin/admin.module";
import { AnalyticsModule } from "@modules/analytics/analytics.module";
import { AppConfigModule } from "@modules/app-config/app-config.module";
import { ApprovalsModule } from "@modules/approvals/approvals.module";
import { BrandModule } from "@modules/catalog/brand/brand.module";
import { BundlesModule } from "@modules/catalog/bundles/bundles.module";
import { CategoryGroupModule } from "@modules/catalog/category-group/category-group.module";
import { CategoryModule } from "@modules/catalog/category/category.module";
import { DeliveryModule } from "@modules/delivery/delivery.module";
import { InventoryModule } from "@modules/inventory/inventory.module";
import { KycModule } from "@modules/kyc/kyc.module";
import { OptionModule } from "@modules/catalog/option/option.module";
import { OrdersModule } from "@modules/orders/orders.module";
import { ProductModule } from "@modules/catalog/product/product.module";
import { SduiModule } from "@modules/sdui/sdui.module";
import { StoresModule } from "@modules/stores/stores.module";
import { SupportModule } from "@modules/support/support.module";
import { UsersModule } from "@modules/users/users.module";
import { Module } from "@nestjs/common";
import { AdminAccessRolesController } from "./access-roles/access-roles.controller";
import { AdminAnalyticsController } from "./analytics/analytics.controller";
import { AdminApprovalsController } from "./approvals/approvals.controller";
import { AdminAuditController } from "./audit/audit.controller";
import { AdminBrandsController } from "./catalog/brands.controller";
import { AdminBundlesController } from "./catalog/bundles.controller";
import { AdminCategoriesController } from "./catalog/categories.controller";
import { AdminCategoryGroupsController } from "./catalog/category-groups.controller";
import { AdminOptionsController } from "./catalog/options.controller";
import { AdminProductsController } from "./catalog/products.controller";
import { AdminAppConfigController } from "./config/config.controller";
import { AdminCouponsController } from "./coupons/coupons.controller";
import { AdminCustomersController } from "./customers/customers.controller";
import { AdminDashboardController } from "./dashboard/dashboard.controller";
import { AdminDeliveryController } from "./delivery/delivery.controller";
import { AdminDeliveryPartnersController } from "./delivery/partners.controller";
import { AdminInventoryCatalogController } from "./inventory/catalog.controller";
import { AdminInventoryFlashSalesController } from "./inventory/flash-sales.controller";
import { AdminInventoryListingsController } from "./inventory/listings.controller";
import { AdminInventoryReceiptsController } from "./inventory/receipts.controller";
import { AdminInventoryReportsController } from "./inventory/reports.controller";
import { AdminInventoryOverviewController } from "./inventory/reports.controller";
import { AdminInventoryStockController } from "./inventory/stock.controller";
import { AdminKycController } from "./kyc/kyc.controller";
import { AdminMediaController } from "./media/media.controller";
import { AdminOrdersController } from "./orders/orders.controller";
import { AdminSduiGroupsController } from "./sdui/groups.controller";
import { AdminSduiRegistryController } from "./sdui/registry.controller";
import { AdminSduiScreensController } from "./sdui/screens.controller";
import { AdminSduiSectionsController } from "./sdui/sections.controller";
import { AdminStoresController } from "./stores/stores.controller";
import { AdminSupportController } from "./support/support.controller";
import { AdminUsersController } from "./users/users.controller";

/** Admin panel API (prefix /admin via RouterModule): ADMIN / SUPER_ADMIN. */
@Module({
    imports: [AdminModule, AnalyticsModule, AppConfigModule, ApprovalsModule, BrandModule, BundlesModule, CategoryGroupModule, CategoryModule, DeliveryModule, InventoryModule, KycModule, OptionModule, OrdersModule, ProductModule, SduiModule, StoresModule, SupportModule, UsersModule],
    controllers: [
        AdminAccessRolesController,
        AdminAnalyticsController,
        AdminApprovalsController,
        AdminAuditController,
        AdminBrandsController,
        AdminBundlesController,
        AdminCategoriesController,
        AdminCategoryGroupsController,
        AdminOptionsController,
        AdminProductsController,
        AdminAppConfigController,
        AdminCouponsController,
        AdminCustomersController,
        AdminDashboardController,
        AdminDeliveryController,
        AdminDeliveryPartnersController,
        AdminInventoryCatalogController,
        AdminInventoryFlashSalesController,
        AdminInventoryListingsController,
        AdminInventoryReceiptsController,
        AdminInventoryReportsController,
        AdminInventoryOverviewController,
        AdminInventoryStockController,
        AdminKycController,
        AdminMediaController,
        AdminOrdersController,
        AdminSduiGroupsController,
        AdminSduiRegistryController,
        AdminSduiScreensController,
        AdminSduiSectionsController,
        AdminStoresController,
        AdminSupportController,
        AdminUsersController,
    ],
})
export class AdminApiModule {}
