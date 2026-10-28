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
    CatalogBrandQuery,
    CatalogCategoryQuery,
    CatalogChangeRequestDto,
    CatalogQuery,
} from "./inventory.dto";
import { CatalogBrowseService } from "@modules/inventory/catalog-browse.service";
import {
    ApiCatalogBrands,
    ApiCatalogCategories,
    ApiCatalogChangeRequest,
    ApiInventoryCatalog,
} from "./inventory.swagger";
import { Body, Get, HttpCode, Param, Post, Query } from "@nestjs/common";
import { UserRole } from "@prisma-client/enums";
import { I18nLang } from "nestjs-i18n";
import { ListingService } from "@modules/inventory/listing.service";
import { StoreController } from "../store-controller.decorator";

/**
 * Store manager / staff: inventory of their own store.
 * Reads + stock operations are open to staff; listing & pricing are manager-only.
 * NOTE: static routes must stay above `:id` routes.
 */
@StoreController("inventory", "Add from catalog", {
    forbidden:
        "Not STORE_MANAGER / STORE_STAFF, permission missing, no store assigned, or a manager-only action",
})
export class StoreInventoryCatalogController {
    constructor(
        private readonly listingService: ListingService,
        private readonly storeScope: StoreScopeService,
        private readonly browse: CatalogBrowseService,
    ) {}

    @Permissions(P.INVENTORY_READ)
    @ApiInventoryCatalog()
    @Get("catalog")
    catalog(
        @Query() query: CatalogQuery,
        @CurrentUser() u: AuthUser,
        @I18nLang() lang: string,
    ) {
        return this.listingService.catalog(
            this.storeScope.scope(u),
            query,
            lang,
        );
    }

    @Permissions(P.INVENTORY_READ)
    @ApiCatalogCategories()
    @Get("catalog/categories")
    catalogCategories(
        @Query() q: CatalogCategoryQuery,
        @CurrentUser() u: AuthUser,
        @I18nLang() lang: string,
    ) {
        return this.browse.categories(this.storeScope.scope(u), q, lang);
    }

    @Permissions(P.INVENTORY_READ)
    @ApiCatalogBrands()
    @Get("catalog/brands")
    catalogBrands(
        @Query() q: CatalogBrandQuery,
        @CurrentUser() u: AuthUser,
        @I18nLang() lang: string,
    ) {
        return this.browse.brands(this.storeScope.scope(u), q, lang);
    }

    @Roles(UserRole.STORE_MANAGER)
    @Permissions(P.INVENTORY_WRITE)
    @ApiCatalogChangeRequest()
    @Post("products/:productId/change-requests")
    @HttpCode(200)
    catalogChange(
        @Param("productId", ParseBigIntPipe) productId: bigint,
        @Body() dto: CatalogChangeRequestDto,
        @CurrentUser() u: AuthUser,
    ) {
        return this.browse.requestChange(
            this.storeScope.scope(u),
            productId,
            dto,
            u,
        );
    }
}
