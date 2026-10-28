import { P } from "@common/authorization/permissions";
import { StoreScopeService } from "@common/authorization/store-scope.service";
import {
    CurrentUser,
    Permissions,
    Roles,
} from "@common/decorators/auth.decorator";
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
} from "./inventory.dto";
import {
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
} from "./inventory.swagger";
import { Body, Get, HttpCode, Param, Patch, Post, Query } from "@nestjs/common";
import { UserRole } from "@prisma-client/enums";
import { I18nLang } from "nestjs-i18n";
import { ListingService } from "@modules/inventory/listing.service";
import { StoreController } from "../store-controller.decorator";

/**
 * Store manager / staff: inventory of their own store.
 * Reads + stock operations are open to staff; listing & pricing are manager-only.
 * NOTE: static routes must stay above `:id` routes.
 */
@StoreController("inventory", "Listings", {
    forbidden:
        "Not STORE_MANAGER / STORE_STAFF, permission missing, no store assigned, or a manager-only action",
})
export class StoreInventoryListingsController {
    constructor(
        private readonly listingService: ListingService,
        private readonly storeScope: StoreScopeService,
    ) {}

    @Roles(UserRole.STORE_MANAGER)
    @Permissions(P.INVENTORY_WRITE)
    @ApiProposeBarcodes()
    @Post("listings/:id/barcodes")
    @HttpCode(200)
    barcodes(
        @Param("id", ParseBigIntPipe) id: bigint,
        @Body() dto: ProposeBarcodesDto,
        @CurrentUser() u: AuthUser,
    ) {
        return this.listingService.proposeBarcodes(
            this.storeScope.scope(u),
            id,
            dto,
            u,
        );
    }

    @Permissions(P.INVENTORY_READ)
    @ApiInventoryProduct()
    @Get("products/:productId")
    product(
        @Param("productId", ParseBigIntPipe) productId: bigint,
        @CurrentUser() u: AuthUser,
        @I18nLang() lang: string,
    ) {
        return this.listingService.productListing(
            this.storeScope.scope(u),
            productId,
            lang,
        );
    }

    @Permissions(P.INVENTORY_READ)
    @ApiInventoryListings()
    @Get("listings")
    listings(
        @Query() query: StockListQuery,
        @CurrentUser() u: AuthUser,
        @I18nLang() lang: string,
    ) {
        return this.listingService.listStock(
            this.storeScope.scope(u),
            query,
            lang,
        );
    }

    @Permissions(P.INVENTORY_READ)
    @ApiInventoryListing()
    @Get("listings/:id")
    listing(
        @Param("id", ParseBigIntPipe) id: bigint,
        @CurrentUser() u: AuthUser,
        @I18nLang() lang: string,
    ) {
        return this.listingService.getListing(
            this.storeScope.scope(u),
            id,
            lang,
        );
    }

    @Permissions(P.INVENTORY_READ)
    @ApiInventoryPriceHistory()
    @Get("listings/:id/price-history")
    priceHistory(
        @Param("id", ParseBigIntPipe) id: bigint,
        @Query() query: MovementQuery,
        @CurrentUser() u: AuthUser,
    ) {
        return this.listingService.priceHistory(
            this.storeScope.scope(u),
            id,
            query,
        );
    }

    // ------------------ listing & pricing (manager) ------------------

    @Roles(UserRole.STORE_MANAGER)
    @Permissions(P.INVENTORY_WRITE)
    @ApiListProduct()
    @Post("products")
    listProduct(
        @Body() dto: ListProductOnStoreDto,
        @CurrentUser() u: AuthUser,
        @I18nLang() lang: string,
    ) {
        return this.listingService.listProduct(
            this.storeScope.scope(u),
            dto,
            u,
            lang,
        );
    }

    @Roles(UserRole.STORE_MANAGER)
    @Permissions(P.INVENTORY_WRITE)
    @ApiVariantStatus()
    @Patch("products/:productId/variants/:variantId")
    toggleVariant(
        @Param("productId", ParseBigIntPipe) productId: bigint,
        @Param("variantId", ParseBigIntPipe) variantId: bigint,
        @Body() dto: ListingStatusDto,
        @CurrentUser() u: AuthUser,
        @I18nLang() lang: string,
    ) {
        return this.listingService.setVariantStatus(
            this.storeScope.scope(u),
            productId,
            variantId,
            dto,
            lang,
        );
    }

    @Roles(UserRole.STORE_MANAGER)
    @Permissions(P.INVENTORY_WRITE)
    @ApiResyncSnapshot()
    @Post("products/:productId/resync-snapshot")
    @HttpCode(200)
    resync(
        @Param("productId", ParseBigIntPipe) productId: bigint,
        @CurrentUser() u: AuthUser,
        @I18nLang() lang: string,
    ) {
        return this.listingService.resyncSnapshot(
            this.storeScope.scope(u),
            productId,
            lang,
        );
    }

    /** Manager picks one admin-catalogue variant and lists it with their own price (<= MRP). */
    @Roles(UserRole.STORE_MANAGER)
    @Permissions(P.INVENTORY_WRITE)
    @ApiCreateListing()
    @Post("listings")
    createListing(@Body() d: ListOnStoreDto, @CurrentUser() u: AuthUser) {
        return this.listingService.listOnStore(this.storeScope.scope(u), d, u);
    }

    @Roles(UserRole.STORE_MANAGER)
    @Permissions(P.INVENTORY_WRITE)
    @ApiBulkPrice()
    @Post("listings/bulk-price")
    @HttpCode(200)
    bulkPrice(@Body() dto: BulkPriceDto, @CurrentUser() u: AuthUser) {
        return this.listingService.bulkPrice(this.storeScope.scope(u), dto, u);
    }

    @Roles(UserRole.STORE_MANAGER)
    @Permissions(P.INVENTORY_WRITE)
    @ApiBulkStatus()
    @Post("listings/bulk-status")
    @HttpCode(200)
    bulkStatus(@Body() dto: BulkListingStatusDto, @CurrentUser() u: AuthUser) {
        return this.listingService.bulkStatus(this.storeScope.scope(u), dto);
    }

    @Roles(UserRole.STORE_MANAGER)
    @Permissions(P.INVENTORY_WRITE)
    @ApiUpdateListing()
    @Patch("listings/:id")
    updateListing(
        @Param("id", ParseBigIntPipe) id: bigint,
        @Body() d: UpdateListingDto,
        @CurrentUser() u: AuthUser,
        @I18nLang() lang: string,
    ) {
        return this.listingService.updateListing(
            this.storeScope.scope(u),
            id,
            d,
            u,
            lang,
        );
    }
}
