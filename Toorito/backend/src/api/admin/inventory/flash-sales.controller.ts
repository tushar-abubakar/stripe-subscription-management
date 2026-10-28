import { P } from "@common/authorization/permissions";
import { Permissions } from "@common/decorators/auth.decorator";
import { ParseBigIntPipe } from "@core/http/pipes/parse-bigint.pipe";
import {
    EndFlashSaleDto,
    FlashListQuery,
    FlashSaleDto,
} from "../../store/inventory/inventory.dto";
import {
    ApiAdminStore,
    ApiEndFlashSale,
    ApiListFlashSales,
    ApiSetFlashSale,
} from "../../store/inventory/inventory.swagger";
import { Body, Get, HttpCode, Param, Post, Query } from "@nestjs/common";
import { I18nLang } from "nestjs-i18n";
import { FlashSaleService } from "@modules/inventory/flash-sale.service";
import { AdminController } from "../admin-controller.decorator";

/**
 * Admin: pick any store (`GET admin/inventory/overview`) and manage its
 * inventory under `admin/stores/:storeId/inventory/...` with the same rules
 * as the store manager.
 */
@AdminController(
    "stores/:storeId/inventory",
    "Flash sales",
    "Not ADMIN / SUPER_ADMIN or the `inventory.*` permission is missing",
)
export class AdminInventoryFlashSalesController {
    constructor(private readonly flash: FlashSaleService) {}

    @Permissions(P.INVENTORY_READ)
    @ApiAdminStore()
    @ApiListFlashSales()
    @Get("flash-sales")
    flashSales(
        @Param("storeId", ParseBigIntPipe) storeId: bigint,
        @Query() q: FlashListQuery,
        @I18nLang() lang: string,
    ) {
        return this.flash.listFlashSales(storeId, q, lang);
    }

    // --------------------------- write ---------------------------

    @Permissions(P.INVENTORY_WRITE)
    @ApiAdminStore()
    @ApiSetFlashSale()
    @Post("flash-sales")
    @HttpCode(200)
    setFlash(
        @Param("storeId", ParseBigIntPipe) storeId: bigint,
        @Body() dto: FlashSaleDto,
    ) {
        return this.flash.setFlashSale(storeId, dto);
    }

    @Permissions(P.INVENTORY_WRITE)
    @ApiAdminStore()
    @ApiEndFlashSale()
    @Post("flash-sales/end")
    @HttpCode(200)
    endFlash(
        @Param("storeId", ParseBigIntPipe) storeId: bigint,
        @Body() dto: EndFlashSaleDto,
    ) {
        return this.flash.endFlashSale(storeId, dto.storeProductIds);
    }
}
