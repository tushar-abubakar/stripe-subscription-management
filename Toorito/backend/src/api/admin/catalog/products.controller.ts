import { P } from "@common/authorization/permissions";
import { CurrentUser, Permissions } from "@common/decorators/auth.decorator";
import { AuthUser } from "@common/types/auth.type";
import { ParseBigIntPipe } from "@core/http/pipes/parse-bigint.pipe";
import {
    BulkAssignProductsDto,
    BulkProductIdsDto,
    BulkProductStatusDto,
    CheckProductSlugQuery,
    CheckSkuQuery,
    CreateProductDto,
    GenerateSkusDto,
    ListProductsQuery,
    ManufacturerSuggestionQuery,
    QuickEditProductDto,
    UpdateProductDto,
    UpdateProductOptionsDto,
    UpdateProductStatusDto,
    UpdateVariantDto,
    VariantDto,
} from "./product.dto";
import { ProductService } from "@modules/catalog/product/product.service";
import { ERRORS, EXAMPLES } from "./product.swagger";
import {
    Body,
    Delete,
    Get,
    HttpCode,
    Param,
    Patch,
    Post,
    Query,
} from "@nestjs/common";
import {
    ApiBadRequestResponse,
    ApiConflictResponse,
    ApiCreatedResponse,
    ApiNotFoundResponse,
    ApiOkResponse,
    ApiOperation,
} from "@nestjs/swagger";
import { AdminController } from "../admin-controller.decorator";

@AdminController("catalog/products", "Products")
export class AdminProductsController {
    constructor(private readonly products: ProductService) {}

    // ---------------------------- READ ----------------------------

    @ApiOperation({
        summary: "List products (use `deleted=true` for the trash)",
        description:
            "Filters: `q`, `status`, `type` (simple / variable), `categoryIds` and `groupIds` (category groups; both include sub-categories), `brandIds`, `excludeIds`, `storeId`, `sku`, `barcode`, `deleted`. " +
            "Lists take `?brandIds=5,9` or `?brandIds=5&brandIds=9`; several values = any of them, different filters = all must match. `categoryId` / `brandId` (one value) still work. " +
            "Sort: `new` (default), `price_asc` / `price_desc` (cheapest variant MRP), `name_asc` / `name_desc`, `updated_asc` / `updated_desc`.",
    })
    @ApiOkResponse({
        content: {
            "application/json": {
                examples: {
                    live: {
                        summary: "Live products",
                        value: EXAMPLES.adminList,
                    },
                    trash: {
                        summary: "?deleted=true (trash)",
                        value: EXAMPLES.trashList,
                    },
                },
            },
        },
    })
    @Permissions(P.PRODUCT_READ)
    @Get()
    list(@Query() query: ListProductsQuery) {
        return this.products.adminList(query);
    }

    @ApiOperation({
        summary: "Counts for the status tabs (all, per status, trash)",
    })
    @ApiOkResponse({ schema: { example: EXAMPLES.counts } })
    @Permissions(P.PRODUCT_READ)
    @Get("counts")
    counts() {
        return this.products.adminCounts();
    }

    @ApiOperation({
        summary: "Check whether a product slug is available",
        description:
            "Send `slug` or `title` (the slug is generated from it). When taken, `suggestion` is the next free `slug-N`. " +
            "Pass `excludeId` while editing so a product may keep its own slug. The suggestion is not reserved.",
    })
    @ApiOkResponse({
        content: {
            "application/json": {
                examples: {
                    available: {
                        summary: "Slug is free",
                        value: EXAMPLES.checkSlugAvailable,
                    },
                    taken: {
                        summary: "Slug is taken",
                        value: EXAMPLES.checkSlugTaken,
                    },
                },
            },
        },
    })
    @ApiBadRequestResponse({ schema: { example: ERRORS.slugInputRequired } })
    @Permissions(P.PRODUCT_READ)
    @Get("check-slug")
    checkSlug(@Query() query: CheckProductSlugQuery) {
        return this.products.checkSlug(query);
    }

    @ApiOperation({
        summary:
            "Check whether a SKU is free (SKUs are unique across all products)",
    })
    @ApiOkResponse({ schema: { example: EXAMPLES.checkSku } })
    @Permissions(P.PRODUCT_READ)
    @Get("check-sku")
    checkSku(@Query() query: CheckSkuQuery) {
        return this.products.checkSku(query);
    }

    @ApiOperation({
        summary: "Previously used manufacturer names and addresses",
        description:
            "Address is in `lang` (default language when omitted). With `brandId`, that brand's manufacturers come first.",
    })
    @ApiOkResponse({ schema: { example: EXAMPLES.manufacturerSuggestions } })
    @Permissions(P.PRODUCT_READ)
    @Get("manufacturer-suggestions")
    manufacturerSuggestions(@Query() query: ManufacturerSuggestionQuery) {
        return this.products.manufacturerSuggestions(query);
    }

    @ApiOperation({
        summary: "Get the full admin view of a product",
        description:
            "All translations, option groups, variants (barcodes, option values, media), gallery, brand and category, " +
            "plus `isVariable` and `publishIssues` (what is still missing to publish).",
    })
    @ApiOkResponse({ schema: { example: EXAMPLES.adminProduct } })
    @ApiNotFoundResponse({ schema: { example: ERRORS.productNotFound } })
    @Permissions(P.PRODUCT_READ)
    @Get(":id")
    get(@Param("id", ParseBigIntPipe) id: bigint) {
        return this.products.adminGet(id);
    }

    // ---------------------------- CREATE ----------------------------

    @ApiOperation({
        summary:
            "Create a product. Empty optionGroupIds = simple (one variant), otherwise variable",
        description:
            "`status` DRAFT (default): one of title / category / variant is enough. " +
            "`status` PUBLISHED: every publish rule must pass, otherwise nothing is saved and the 400 lists all problems. " +
            "Missing SKUs and slug are generated; the first gallery image becomes the thumbnail.",
    })
    @ApiCreatedResponse({
        description: "Created product (admin view)",
        schema: { example: EXAMPLES.adminProduct },
    })
    @ApiBadRequestResponse({ schema: { example: ERRORS.publishBlocked } })
    @ApiConflictResponse({ schema: { example: ERRORS.slugTaken } })
    @Permissions(P.PRODUCT_CREATE)
    @Post()
    create(@Body() dto: CreateProductDto, @CurrentUser() user: AuthUser) {
        return this.products.createProduct(dto, user.id);
    }

    @ApiOperation({
        summary: 'Generate unique SKUs for variant rows ("generate all SKUs")',
        description:
            "Built from `slug` / `title` and the option value codes. `reserved` = SKUs already in the form. Nothing is reserved server-side.",
    })
    @ApiOkResponse({ schema: { example: EXAMPLES.generatedSkus } })
    @Permissions(P.PRODUCT_READ)
    @Post("generate-skus")
    @HttpCode(200)
    generateSkus(@Body() dto: GenerateSkusDto) {
        return this.products.generateSkus(dto);
    }

    // ---------------------------- BULK ----------------------------

    @ApiOperation({
        summary: "Bulk publish / draft / archive",
        description:
            "Each product is processed independently; failures are listed with their reason.",
    })
    @ApiOkResponse({ schema: { example: EXAMPLES.bulkResult } })
    @Permissions(P.PRODUCT_PUBLISH)
    @Post("bulk/status")
    @HttpCode(200)
    bulkStatus(@Body() dto: BulkProductStatusDto) {
        return this.products.bulkStatus(dto);
    }

    @ApiOperation({ summary: "Bulk move to trash" })
    @ApiOkResponse({ schema: { example: EXAMPLES.bulkResult } })
    @Permissions(P.PRODUCT_DELETE)
    @Post("bulk/delete")
    @HttpCode(200)
    bulkDelete(@Body() dto: BulkProductIdsDto) {
        return this.products.bulkDelete(dto);
    }

    @ApiOperation({ summary: "Bulk restore from trash" })
    @ApiOkResponse({ schema: { example: EXAMPLES.bulkResult } })
    @Permissions(P.PRODUCT_RESTORE)
    @Post("bulk/restore")
    @HttpCode(200)
    bulkRestore(@Body() dto: BulkProductIdsDto) {
        return this.products.bulkRestore(dto);
    }

    @ApiOperation({ summary: "Bulk permanent delete (trash only)" })
    @ApiOkResponse({ schema: { example: EXAMPLES.bulkResult } })
    @Permissions(P.PRODUCT_PURGE)
    @Post("bulk/purge")
    @HttpCode(200)
    bulkPurge(@Body() dto: BulkProductIdsDto) {
        return this.products.bulkPurge(dto);
    }

    @ApiOperation({ summary: "Bulk assign category and / or brand" })
    @ApiOkResponse({ schema: { example: EXAMPLES.bulkResult } })
    @Permissions(P.PRODUCT_UPDATE)
    @Patch("bulk")
    bulkAssign(@Body() dto: BulkAssignProductsDto) {
        return this.products.bulkAssign(dto);
    }

    // ---------------------------- UPDATE ----------------------------

    // Prefer `PATCH :id`, which can also change option groups.
    @ApiOperation({
        summary: "Re-map option groups and option values of a variable product",
        description:
            "`variants` must contain every existing non-deleted variant exactly once.",
    })
    @ApiOkResponse({ schema: { example: EXAMPLES.adminProduct } })
    @ApiBadRequestResponse({ schema: { example: ERRORS.validation } })
    @ApiNotFoundResponse({ schema: { example: ERRORS.productNotFound } })
    @Permissions(P.PRODUCT_UPDATE)
    @Patch(":id/options")
    updateOptions(
        @Param("id", ParseBigIntPipe) id: bigint,
        @Body() dto: UpdateProductOptionsDto,
    ) {
        return this.products.updateProductOptions(id, dto);
    }

    @ApiOperation({
        summary:
            "Quick edit from the list (title, status, category, brand, variant price / active)",
    })
    @ApiOkResponse({ schema: { example: EXAMPLES.adminProduct } })
    @ApiBadRequestResponse({ schema: { example: ERRORS.publishBlocked } })
    @ApiNotFoundResponse({ schema: { example: ERRORS.productNotFound } })
    @ApiConflictResponse({ schema: { example: ERRORS.staleUpdate } })
    @Permissions(P.PRODUCT_UPDATE)
    @Patch(":id/quick")
    quickEdit(
        @Param("id", ParseBigIntPipe) id: bigint,
        @Body() dto: QuickEditProductDto,
    ) {
        return this.products.quickEdit(id, dto);
    }

    @ApiOperation({
        summary:
            "Update a product like creating it: fields, translations, gallery, simple/variable switch, full variant list and status",
        description:
            "`variants` entries with `id` are edited, entries without `id` are added and existing variants that are not listed are deleted. " +
            "`optionGroupIds: []` makes the product simple; non-empty makes it variable. Omit `variants` to leave variants untouched. " +
            "If the product is (or becomes) PUBLISHED, every publish rule is enforced and a failing edit is rolled back.",
    })
    @ApiOkResponse({ schema: { example: EXAMPLES.adminProduct } })
    @ApiBadRequestResponse({ schema: { example: ERRORS.publishBlocked } })
    @ApiNotFoundResponse({ schema: { example: ERRORS.productNotFound } })
    @ApiConflictResponse({
        content: {
            "application/json": {
                examples: {
                    sku: { summary: "SKU taken", value: ERRORS.skuExists },
                    stale: {
                        summary: "Changed by someone else",
                        value: ERRORS.staleUpdate,
                    },
                },
            },
        },
    })
    @Permissions(P.PRODUCT_UPDATE)
    @Patch(":id")
    update(
        @Param("id", ParseBigIntPipe) id: bigint,
        @Body() dto: UpdateProductDto,
    ) {
        return this.products.updateProduct(id, dto);
    }

    // ---------------------------- STATUS ----------------------------

    @ApiOperation({
        summary: "Change product status (DRAFT / PUBLISHED / ARCHIVED)",
        description:
            "One endpoint for publish, unpublish and archive: send `{ status }`. " +
            "PUBLISHED requires an ACTIVE category, an ACTIVE brand (when set), a default-language title, at least one active priced variant " +
            "and consistent option values; the 400 lists every failing rule. " +
            "Sending the current status is a no-op (`changed: false`). " +
            "Pass `expectedUpdatedAt` to get a 409 instead of acting on a product someone else just changed.",
    })
    @ApiOkResponse({
        content: {
            "application/json": {
                examples: {
                    changed: {
                        summary: "Status changed",
                        value: EXAMPLES.statusChanged,
                    },
                    unchanged: {
                        summary: "Already in that status",
                        value: EXAMPLES.statusUnchanged,
                    },
                },
            },
        },
    })
    @ApiBadRequestResponse({ schema: { example: ERRORS.publishBlocked } })
    @ApiNotFoundResponse({ schema: { example: ERRORS.productNotFound } })
    @ApiConflictResponse({ schema: { example: ERRORS.staleUpdate } })
    @Permissions(P.PRODUCT_PUBLISH)
    @Patch(":id/status")
    updateStatus(
        @Param("id", ParseBigIntPipe) id: bigint,
        @Body() dto: UpdateProductStatusDto,
    ) {
        return this.products.updateStatus(id, dto);
    }

    // ---------------------------- DELETE / RESTORE / PURGE ----------------------------

    @ApiOperation({
        summary: "Soft-delete a product (move to trash)",
        description:
            "Archives the product, frees its slug and variant SKUs, and deactivates store listings. Reversible with `restore`.",
    })
    @ApiOkResponse({ schema: { example: EXAMPLES.successOnly } })
    @ApiNotFoundResponse({ schema: { example: ERRORS.productNotFound } })
    @Permissions(P.PRODUCT_DELETE)
    @Delete(":id")
    delete(@Param("id", ParseBigIntPipe) id: bigint) {
        return this.products.deleteProduct(id);
    }

    @ApiOperation({
        summary: "Restore a product from the trash",
        description:
            "Restores original status, slug, SKUs and listing activity. Fails with 409 if the slug / SKU was reused meanwhile.",
    })
    @ApiOkResponse({ schema: { example: EXAMPLES.restored } })
    @ApiNotFoundResponse({ schema: { example: ERRORS.trashNotFound } })
    @ApiConflictResponse({ schema: { example: ERRORS.restoreConflict } })
    @Permissions(P.PRODUCT_RESTORE)
    @Post(":id/restore")
    @HttpCode(200)
    restore(@Param("id", ParseBigIntPipe) id: bigint) {
        return this.products.restoreProduct(id);
    }

    @ApiOperation({
        summary: "Permanently delete a product that is already in the trash",
        description:
            "Irreversible. Returns 409 when something else (for example past orders) still references the product.",
    })
    @ApiOkResponse({ schema: { example: EXAMPLES.successWithId } })
    @ApiNotFoundResponse({ schema: { example: ERRORS.trashNotFound } })
    @ApiConflictResponse({ schema: { example: ERRORS.purgeInUse } })
    @Permissions(P.PRODUCT_PURGE)
    @Delete(":id/purge")
    purge(@Param("id", ParseBigIntPipe) id: bigint) {
        return this.products.purgeProduct(id);
    }

    // ---------------------------- VARIANTS ----------------------------

    @ApiOperation({
        summary: "Add a variant to a variable product",
        description:
            "SKU is generated when omitted. Max 100 variants per product.",
    })
    @ApiCreatedResponse({ schema: { example: EXAMPLES.createdVariant } })
    @ApiBadRequestResponse({ schema: { example: ERRORS.validation } })
    @ApiNotFoundResponse({ schema: { example: ERRORS.productNotFound } })
    @ApiConflictResponse({ schema: { example: ERRORS.skuExists } })
    @Permissions(P.VARIANT_CREATE)
    @Post(":id/variants")
    addVariant(
        @Param("id", ParseBigIntPipe) id: bigint,
        @Body() dto: VariantDto,
    ) {
        return this.products.addVariant(id, dto);
    }

    @ApiOperation({
        summary:
            "Update a variant (price, units, active flag, barcodes, media)",
        description:
            "SKU and option values cannot be changed here; use `PATCH :id`.",
    })
    @ApiOkResponse({ schema: { example: EXAMPLES.successOnly } })
    @ApiNotFoundResponse({ schema: { example: ERRORS.variantNotFound } })
    @Permissions(P.VARIANT_UPDATE)
    @Patch("variants/:id")
    updateVariant(
        @Param("id", ParseBigIntPipe) id: bigint,
        @Body() dto: UpdateVariantDto,
    ) {
        return this.products.updateVariant(id, dto);
    }

    @ApiOperation({
        summary: "Soft-delete a variant",
        description:
            "A published product must keep at least one active variant.",
    })
    @ApiOkResponse({ schema: { example: EXAMPLES.successOnly } })
    @ApiBadRequestResponse({ schema: { example: ERRORS.validation } })
    @ApiNotFoundResponse({ schema: { example: ERRORS.variantNotFound } })
    @Permissions(P.VARIANT_DELETE)
    @Delete("variants/:id")
    deleteVariant(@Param("id", ParseBigIntPipe) id: bigint) {
        return this.products.deleteVariant(id);
    }
}
