import { P } from "@common/authorization/permissions";
import { StoreScopeService } from "@common/authorization/store-scope.service";
import {
    CurrentUser,
    Permissions,
    Roles,
} from "@common/decorators/auth.decorator";
import { AuthUser } from "@common/types/auth.type";
import { EndFlashSaleDto, FlashListQuery, FlashSaleDto } from "./inventory.dto";
import {
    ApiEndFlashSale,
    ApiListFlashSales,
    ApiSetFlashSale,
} from "./inventory.swagger";
import { Body, Get, HttpCode, Post, Query } from "@nestjs/common";
import { UserRole } from "@prisma-client/enums";
import { I18nLang } from "nestjs-i18n";
import { FlashSaleService } from "@modules/inventory/flash-sale.service";
import { StoreController } from "../store-controller.decorator";

/**
 * Store manager / staff: inventory of their own store.
 * Reads + stock operations are open to staff; listing & pricing are manager-only.
 * NOTE: static routes must stay above `:id` routes.
 */
@StoreController("inventory", "Flash sales", {
    forbidden:
        "Not STORE_MANAGER / STORE_STAFF, permission missing, no store assigned, or a manager-only action",
})
export class StoreInventoryFlashSalesController {
    constructor(
        private readonly flash: FlashSaleService,
        private readonly storeScope: StoreScopeService,
    ) {}

    @Permissions(P.INVENTORY_READ)
    @ApiListFlashSales()
    @Get("flash-sales")
    flashSales(
        @Query() q: FlashListQuery,
        @CurrentUser() u: AuthUser,
        @I18nLang() lang: string,
    ) {
        return this.flash.listFlashSales(this.storeScope.scope(u), q, lang);
    }

    @Roles(UserRole.STORE_MANAGER)
    @Permissions(P.INVENTORY_WRITE)
    @ApiSetFlashSale()
    @Post("flash-sales")
    @HttpCode(200)
    setFlash(@Body() dto: FlashSaleDto, @CurrentUser() u: AuthUser) {
        return this.flash.setFlashSale(this.storeScope.scope(u), dto);
    }

    @Roles(UserRole.STORE_MANAGER)
    @Permissions(P.INVENTORY_WRITE)
    @ApiEndFlashSale()
    @Post("flash-sales/end")
    @HttpCode(200)
    endFlash(@Body() dto: EndFlashSaleDto, @CurrentUser() u: AuthUser) {
        return this.flash.endFlashSale(
            this.storeScope.scope(u),
            dto.storeProductIds,
        );
    }
}
