import { P } from "@common/authorization/permissions";
import { Permissions } from "@common/decorators/auth.decorator";
import { ParseBigIntPipe } from "@core/http/pipes/parse-bigint.pipe";
import {
    CatalogBrandQuery,
    CatalogCategoryQuery,
    CatalogQuery,
} from "../../store/inventory/inventory.dto";
import { CatalogBrowseService } from "@modules/inventory/catalog-browse.service";
import {
    ApiCatalogBrands,
    ApiCatalogCategories,
    ApiAdminStore,
    ApiInventoryCatalog,
} from "../../store/inventory/inventory.swagger";
import { Get, Param, Query } from "@nestjs/common";
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
    "Add from catalog",
    "Not ADMIN / SUPER_ADMIN or the `inventory.*` permission is missing",
)
export class AdminInventoryCatalogController {
    constructor(
        private readonly listingService: ListingService,
        private readonly browse: CatalogBrowseService,
    ) {}

    @Permissions(P.INVENTORY_READ)
    @ApiAdminStore()
    @ApiInventoryCatalog()
    @Get("catalog")
    catalog(
        @Param("storeId", ParseBigIntPipe) storeId: bigint,
        @Query() query: CatalogQuery,
        @I18nLang() lang: string,
    ) {
        return this.listingService.catalog(storeId, query, lang);
    }

    @Permissions(P.INVENTORY_READ)
    @ApiAdminStore()
    @ApiCatalogCategories()
    @Get("catalog/categories")
    catalogCategories(
        @Param("storeId", ParseBigIntPipe) storeId: bigint,
        @Query() q: CatalogCategoryQuery,
        @I18nLang() lang: string,
    ) {
        return this.browse.categories(storeId, q, lang);
    }

    @Permissions(P.INVENTORY_READ)
    @ApiAdminStore()
    @ApiCatalogBrands()
    @Get("catalog/brands")
    catalogBrands(
        @Param("storeId", ParseBigIntPipe) storeId: bigint,
        @Query() q: CatalogBrandQuery,
        @I18nLang() lang: string,
    ) {
        return this.browse.brands(storeId, q, lang);
    }
}
