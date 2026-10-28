import { P } from "@common/authorization/permissions";
import { CurrentUser, Permissions } from "@common/decorators/auth.decorator";
import { AuthUser } from "@common/types/auth.type";
import { ParseBigIntPipe } from "@core/http/pipes/parse-bigint.pipe";
import {
    BulkListingStatusDto,
    ProposeBarcodesDto,
    BulkPriceDto,
    ListingStatusDto,
    ListOnStoreDto,
    ListProductOnStoreDto,
    MovementQuery,
    StockListQuery,
    UpdateListingDto,
} from "../../store/inventory/inventory.dto";
import {
    ApiAdminStore,
    ApiBulkPrice,
    ApiBulkStatus,
    ApiProposeBarcodes,
    ApiCreateListing,
    ApiInventoryListing,
    ApiInventoryListings,
    ApiInventoryPriceHistory,
    ApiInventoryProduct,
    ApiListProduct,
    ApiResyncSnapshot,
    ApiVariantStatus,
    ApiUpdateListing,
} from "../../store/inventory/inventory.swagger";
import { Body, Get, HttpCode, Param, Patch, Post, Query } from "@nestjs/common";
import { I18nLang } from "nestjs-i18n";
import { ListingService } from "@modules/inventory/listing.service";
import { AdminController } from "../admin-controller.decorator";

/**
 * Admin: pick any store (`GET admin/inventory/overview`) and manage its
 * inventory under `admin/stores/:storeId/inventory/...` with the same rules
 * as the store manager.
 */
@AdminController(
    "stores/:storeId/inventory",
    "Listings",
    "Not ADMIN / SUPER_ADMIN or the `inventory.*` permission is missing",
)
export class AdminInventoryListingsController {
    constructor(private readonly listingService: ListingService) {}

    @Permissions(P.INVENTORY_READ)
    @ApiAdminStore()
    @ApiInventoryProduct()
    @Get("products/:productId")
    product(
        @Param("storeId", ParseBigIntPipe) storeId: bigint,
        @Param("productId", ParseBigIntPipe) productId: bigint,
        @I18nLang() lang: string,
    ) {
        return this.listingService.productListing(storeId, productId, lang);
    }

    @Permissions(P.INVENTORY_READ)
    @ApiAdminStore()
    @ApiInventoryListings()
    @Get("listings")
    listings(
        @Param("storeId", ParseBigIntPipe) storeId: bigint,
        @Query() query: StockListQuery,
        @I18nLang() lang: string,
    ) {
        return this.listingService.listStock(storeId, query, lang);
    }

    @Permissions(P.INVENTORY_READ)
    @ApiAdminStore()
    @ApiInventoryListing()
    @Get("listings/:id")
    listing(
        @Param("storeId", ParseBigIntPipe) storeId: bigint,
        @Param("id", ParseBigIntPipe) id: bigint,
        @I18nLang() lang: string,
    ) {
        return this.listingService.getListing(storeId, id, lang);
    }

    @Permissions(P.INVENTORY_READ)
    @ApiAdminStore()
    @ApiInventoryPriceHistory()
    @Get("listings/:id/price-history")
    priceHistory(
        @Param("storeId", ParseBigIntPipe) storeId: bigint,
        @Param("id", ParseBigIntPipe) id: bigint,
        @Query() query: MovementQuery,
    ) {
        return this.listingService.priceHistory(storeId, id, query);
    }

    @Permissions(P.INVENTORY_WRITE)
    @ApiAdminStore()
    @ApiProposeBarcodes()
    @Post("listings/:id/barcodes")
    @HttpCode(200)
    barcodes(
        @Param("storeId", ParseBigIntPipe) storeId: bigint,
        @Param("id", ParseBigIntPipe) id: bigint,
        @Body() dto: ProposeBarcodesDto,
        @CurrentUser() user: AuthUser,
    ) {
        return this.listingService.proposeBarcodes(storeId, id, dto, user);
    }

    @Permissions(P.INVENTORY_WRITE)
    @ApiAdminStore()
    @ApiListProduct()
    @Post("products")
    listProduct(
        @Param("storeId", ParseBigIntPipe) storeId: bigint,
        @Body() dto: ListProductOnStoreDto,
        @CurrentUser() user: AuthUser,
        @I18nLang() lang: string,
    ) {
        return this.listingService.listProduct(storeId, dto, user, lang);
    }

    @Permissions(P.INVENTORY_WRITE)
    @ApiAdminStore()
    @ApiVariantStatus()
    @Patch("products/:productId/variants/:variantId")
    toggleVariant(
        @Param("storeId", ParseBigIntPipe) storeId: bigint,
        @Param("productId", ParseBigIntPipe) productId: bigint,
        @Param("variantId", ParseBigIntPipe) variantId: bigint,
        @Body() dto: ListingStatusDto,
        @I18nLang() lang: string,
    ) {
        return this.listingService.setVariantStatus(
            storeId,
            productId,
            variantId,
            dto,
            lang,
        );
    }

    @Permissions(P.INVENTORY_WRITE)
    @ApiAdminStore()
    @ApiResyncSnapshot()
    @Post("products/:productId/resync-snapshot")
    @HttpCode(200)
    resync(
        @Param("storeId", ParseBigIntPipe) storeId: bigint,
        @Param("productId", ParseBigIntPipe) productId: bigint,
        @I18nLang() lang: string,
    ) {
        return this.listingService.resyncSnapshot(storeId, productId, lang);
    }

    @Permissions(P.INVENTORY_WRITE)
    @ApiAdminStore()
    @ApiCreateListing()
    @Post("listings")
    createListing(
        @Param("storeId", ParseBigIntPipe) storeId: bigint,
        @Body() dto: ListOnStoreDto,
        @CurrentUser() user: AuthUser,
    ) {
        return this.listingService.listOnStore(storeId, dto, user);
    }

    @Permissions(P.INVENTORY_WRITE)
    @ApiAdminStore()
    @ApiBulkPrice()
    @Post("listings/bulk-price")
    @HttpCode(200)
    bulkPrice(
        @Param("storeId", ParseBigIntPipe) storeId: bigint,
        @Body() dto: BulkPriceDto,
        @CurrentUser() user: AuthUser,
    ) {
        return this.listingService.bulkPrice(storeId, dto, user);
    }

    @Permissions(P.INVENTORY_WRITE)
    @ApiAdminStore()
    @ApiBulkStatus()
    @Post("listings/bulk-status")
    @HttpCode(200)
    bulkStatus(
        @Param("storeId", ParseBigIntPipe) storeId: bigint,
        @Body() dto: BulkListingStatusDto,
    ) {
        return this.listingService.bulkStatus(storeId, dto);
    }

    @Permissions(P.INVENTORY_WRITE)
    @ApiAdminStore()
    @ApiUpdateListing()
    @Patch("listings/:id")
    updateListing(
        @Param("storeId", ParseBigIntPipe) storeId: bigint,
        @Param("id", ParseBigIntPipe) id: bigint,
        @Body() dto: UpdateListingDto,
        @CurrentUser() user: AuthUser,
        @I18nLang() lang: string,
    ) {
        return this.listingService.updateListing(storeId, id, dto, user, lang);
    }
}
