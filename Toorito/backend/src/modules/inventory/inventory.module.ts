import { NotificationsModule } from "@modules/notifications/notifications.module";
import { Module } from "@nestjs/common";
import { CatalogBrowseService } from "./catalog-browse.service";
import { FlashSaleService } from "./flash-sale.service";
import { InventoryCacheService } from "./inventory-cache.service";
import { InventoryReportService } from "./inventory-report.service";
import { InventoryApprovals } from "./inventory.approvals";
import { InventoryCron } from "./inventory.cron";
import { ListingRulesService } from "./listing-rules.service";
import { ListingService } from "./listing.service";
import { ReceiptService } from "./receipt.service";
import { StockService } from "./stock.service";

/**
 * Store inventory: listings (store-side snapshot of catalogue variants with
 * the store's own price), batches, stock in / out, reservations and ledger.
 * HTTP lives in src/api/store/inventory (own store) and src/api/admin/inventory (any store).
 *
 * - `ListingService`         add from catalogue, price / status edits, scheduled publishing
 * - `StockService`           reserve / release / FEFO pick (orders, returns), stock out, adjust, batches, expiry
 * - `ReceiptService`         goods receipts (GRN) and approved GRN corrections
 * - `FlashSaleService`       flash sales
 * - `InventoryReportService` ledger, summary, expiry, low stock, admin overview
 * - `CatalogBrowseService`   "Add from catalog": facets, product media, change requests to the admin
 * - `InventoryApprovals`     approval handlers (barcodes, GRN edits)
 * - `InventoryCron`          scheduled publishing, expiry sweep
 */
@Module({
    imports: [NotificationsModule],
    providers: [
        InventoryCacheService,
        ListingRulesService,
        ListingService,
        StockService,
        ReceiptService,
        FlashSaleService,
        InventoryReportService,
        CatalogBrowseService,
        InventoryApprovals,
        InventoryCron,
    ],
    exports: [
        ListingService,
        StockService,
        ReceiptService,
        FlashSaleService,
        InventoryReportService,
        CatalogBrowseService,
        InventoryApprovals,
    ],
})
export class InventoryModule {}
