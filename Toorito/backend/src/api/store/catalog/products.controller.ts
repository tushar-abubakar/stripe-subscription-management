import { P } from "@common/authorization/permissions";
import {
    CurrentUser,
    Permissions,
    Roles,
} from "@common/decorators/auth.decorator";
import { AuthUser } from "@common/types/auth.type";
import { ParseBigIntPipe } from "@core/http/pipes/parse-bigint.pipe";
import {
    StoreProductMediaDto,
    StoreProductsQuery,
} from "../../admin/catalog/product.dto";
import { ProductService } from "@modules/catalog/product/product.service";
import {
    ApiStoreAddProductMedia,
    ApiStoreRemoveProductMedia,
    ERRORS,
    EXAMPLES,
} from "../../admin/catalog/product.swagger";
import {
    Body,
    Delete,
    Get,
    HttpCode,
    Param,
    Post,
    Query,
} from "@nestjs/common";
import {
    ApiNotFoundResponse,
    ApiOkResponse,
    ApiOperation,
} from "@nestjs/swagger";
import { ProductStatus, UserRole } from "@prisma-client/enums";
import { StoreController } from "../store-controller.decorator";

@StoreController("catalog/products", "Catalog")
export class StoreCatalogProductsController {
    constructor(private readonly products: ProductService) {}

    @ApiOperation({
        summary: "List PUBLISHED products of the global catalogue",
        description:
            "Filters: `q`, `type`, `categoryIds` / `groupIds` (include sub-categories), `brandIds`, `excludeIds`, `sku`, `barcode`. Several values of one filter = any of them; different filters = all must match. " +
            "Sort: `new` (default), `price_asc`, `price_desc`, `name_asc`, `name_desc`, `updated_asc`, `updated_desc`.",
    })
    @ApiOkResponse({ schema: { example: EXAMPLES.adminList } })
    @Permissions(P.PRODUCT_READ)
    @Get()
    list(@Query() query: StoreProductsQuery) {
        return this.products.adminList({
            ...query,
            status: ProductStatus.PUBLISHED,
        });
    }

    @ApiOperation({
        summary: "Get one PUBLISHED product of the global catalogue",
    })
    @ApiOkResponse({ schema: { example: EXAMPLES.adminProduct } })
    @ApiNotFoundResponse({ schema: { example: ERRORS.productNotFound } })
    @Permissions(P.PRODUCT_READ)
    @Get(":id")
    get(@Param("id", ParseBigIntPipe) id: bigint) {
        return this.products.storeGet(id);
    }

    @Roles(UserRole.STORE_MANAGER)
    @Permissions(P.PRODUCT_MEDIA)
    @ApiStoreAddProductMedia()
    @Post(":id/media")
    @HttpCode(200)
    addMedia(
        @Param("id", ParseBigIntPipe) id: bigint,
        @Body() dto: StoreProductMediaDto,
        @CurrentUser() user: AuthUser,
    ) {
        return this.products.storeAddMedia(
            user.id,
            id,
            dto.mediaIds,
            dto.variantId,
        );
    }

    @Roles(UserRole.STORE_MANAGER)
    @Permissions(P.PRODUCT_MEDIA)
    @ApiStoreRemoveProductMedia()
    @Delete(":id/media/:mediaId")
    removeMedia(
        @Param("id", ParseBigIntPipe) id: bigint,
        @Param("mediaId", ParseBigIntPipe) mediaId: bigint,
        @CurrentUser() user: AuthUser,
    ) {
        return this.products.storeRemoveMedia(user.id, id, mediaId);
    }
}
