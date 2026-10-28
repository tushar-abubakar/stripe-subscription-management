import {
    ProductDetailQuery,
    StorefrontProductsQuery,
} from "../../admin/catalog/product.dto";
import { ProductService } from "@modules/catalog/product/product.service";
import { ERRORS, EXAMPLES } from "../../admin/catalog/product.swagger";
import { Get, Param, Query } from "@nestjs/common";
import {
    ApiBadRequestResponse,
    ApiNotFoundResponse,
    ApiOkResponse,
    ApiOperation,
} from "@nestjs/swagger";
import { I18nLang } from "nestjs-i18n";
import { PublicController } from "../public-controller.decorator";

@PublicController("catalog/products", "Catalog")
export class PublicProductsController {
    constructor(private readonly products: ProductService) {}

    @ApiOperation({
        summary: "List published products of a store",
        description:
            "Requires `storeId`. Supports search (`q`), `categoryIds` and `groupIds` (category groups; both include sub-categories), `brandIds` (comma-separated or repeated; one value per filter type is OR-ed, filter types are AND-ed) and sort (`new`, `price_asc`, `price_desc`). " +
            "Paginated per product; `hasMore` tells whether another page exists.",
    })
    @ApiOkResponse({
        description: "Product cards",
        schema: { example: EXAMPLES.storefrontList },
    })
    @ApiBadRequestResponse({ schema: { example: ERRORS.storeIdRequired } })
    @Get()
    list(@Query() query: StorefrontProductsQuery, @I18nLang() lang: string) {
        return this.products.storefrontList(query, lang);
    }

    @ApiOperation({
        summary: "Product detail by slug",
        description:
            "With `storeId`, variants are limited to those listed in that store and include price, stock and min/max quantity.",
    })
    @ApiOkResponse({
        description: "Product detail",
        schema: { example: EXAMPLES.storefrontDetail },
    })
    @ApiNotFoundResponse({ schema: { example: ERRORS.productNotFound } })
    @Get(":slug")
    detail(
        @Param("slug") slug: string,
        @Query() query: ProductDetailQuery,
        @I18nLang() lang: string,
    ) {
        return this.products.storefrontDetail(
            slug,
            query.storeId ? BigInt(query.storeId) : undefined,
            lang,
        );
    }
}
