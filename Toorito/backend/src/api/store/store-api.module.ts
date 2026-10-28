import { AnalyticsModule } from "@modules/analytics/analytics.module";
import { AppConfigModule } from "@modules/app-config/app-config.module";
import { ApprovalsModule } from "@modules/approvals/approvals.module";
import { BundlesModule } from "@modules/catalog/bundles/bundles.module";
import { DeliveryModule } from "@modules/delivery/delivery.module";
import { InventoryModule } from "@modules/inventory/inventory.module";
import { KycModule } from "@modules/kyc/kyc.module";
import { OrdersModule } from "@modules/orders/orders.module";
import { ProductModule } from "@modules/catalog/product/product.module";
import { StoresModule } from "@modules/stores/stores.module";
import { SupportModule } from "@modules/support/support.module";
import { UsersModule } from "@modules/users/users.module";
import { Module } from "@nestjs/common";
import { StoreAnalyticsController } from "./analytics/analytics.controller";
import { StoreApprovalsController } from "./approvals/approvals.controller";
import { StoreBundlesController } from "./catalog/bundles.controller";
import { StoreCatalogProductsController } from "./catalog/products.controller";
import { StoreAppConfigController } from "./config/config.controller";
import { StoreDeliveriesController } from "./deliveries/deliveries.controller";
import { StoreInventoryCatalogController } from "./inventory/catalog.controller";
import { StoreInventoryFlashSalesController } from "./inventory/flash-sales.controller";
import { StoreInventoryListingsController } from "./inventory/listings.controller";
import { StoreInventoryReceiptsController } from "./inventory/receipts.controller";
import { StoreInventoryReportsController } from "./inventory/reports.controller";
import { StoreInventoryStockController } from "./inventory/stock.controller";
import { StoreKycController } from "./kyc/kyc.controller";
import { StoreMemberKycController } from "./kyc/member-kyc.controller";
import { StoreMediaController } from "./media/media.controller";
import { StoreOrdersController } from "./orders/orders.controller";
import { StoreProfileController } from "./profile/profile.controller";
import { StoreSupportController } from "./support/support.controller";
import { StoreTeamController } from "./team/team.controller";

/** Store manager / staff app API (prefix /store via RouterModule): own store only. */
@Module({
    imports: [AnalyticsModule, AppConfigModule, ApprovalsModule, BundlesModule, DeliveryModule, InventoryModule, KycModule, OrdersModule, ProductModule, StoresModule, SupportModule, UsersModule],
    controllers: [
        StoreAnalyticsController,
        StoreApprovalsController,
        StoreBundlesController,
        StoreCatalogProductsController,
        StoreAppConfigController,
        StoreDeliveriesController,
        StoreInventoryCatalogController,
        StoreInventoryFlashSalesController,
        StoreInventoryListingsController,
        StoreInventoryReceiptsController,
        StoreInventoryReportsController,
        StoreInventoryStockController,
        StoreKycController,
        StoreMemberKycController,
        StoreMediaController,
        StoreOrdersController,
        StoreProfileController,
        StoreSupportController,
        StoreTeamController,
    ],
})
export class StoreApiModule {}
