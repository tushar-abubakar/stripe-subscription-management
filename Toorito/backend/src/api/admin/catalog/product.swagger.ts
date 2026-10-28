/**
 * Swagger sample responses for the product controllers.
 *
 * Documentation only. Ids are strings because bigint ids are serialized as
 * strings in JSON. Money values are formatted by `CurrencyService.format`.
 */

import { applyDecorators } from "@nestjs/common";
import {
    ApiBadRequestResponse,
    ApiBody,
    ApiForbiddenResponse,
    ApiNotFoundResponse,
    ApiOkResponse,
    ApiOperation,
    ApiParam,
    ApiProperty,
    ApiPropertyOptional,
} from "@nestjs/swagger";

const CURRENCY = { code: "INR", symbol: "₹", decimals: 2 };

/** Builds a standard Nest error body. */
const errorExample = (
    statusCode: number,
    error: string,
    message: string | string[],
) => ({ statusCode, error, message });

// ============ shared building blocks ============

const NUTRITION_TABLE_EN = {
    columns: [{ label: "Per 100 g" }, { label: "Per serving (30 g)" }],
    rows: [
        { label: "Energy", values: ["350 kcal", "105 kcal"] },
        {
            label: "Carbohydrate",
            values: ["78 g", "23.4 g"],
            children: [
                { label: "of which sugars", values: ["0.2 g", "0.1 g"] },
            ],
        },
    ],
};

const ADMIN_PRODUCT = {
    id: "101",
    slug: "organic-basmati-rice",
    status: "PUBLISHED",
    categoryId: "12",
    brandId: "5",
    thumbnailId: "880",
    audioMediaId: null,
    dietType: "VEG",
    hsnCode: "10063020",
    gstRate: "5",
    countryOfOrigin: "IN",
    shelfLifeDays: 365,
    isPerishable: false,
    manufacturerName: "Green Farms Pvt Ltd",
    nutrition: { basis: "PER_100G", servingSize: "30g" },
    createdById: "1",
    publishedAt: "2026-10-01T09:30:00.000Z",
    deletedAt: null,
    createdAt: "2026-09-28T10:00:00.000Z",
    updatedAt: "2026-10-01T09:30:00.000Z",
    isVariable: true,
    publishIssues: [],
    translations: [
        {
            productId: "101",
            lang: "en",
            title: "Organic Basmati Rice",
            shortDescription: "Aged long-grain basmati rice",
            description: "Premium aged basmati, naturally grown.",
            keyFeatures: [
                { name: "Aged", value: "24 months" },
                { name: "Polish", value: "None" },
            ],
            ingredients: "Basmati rice",
            storageInstructions: "Store in a cool, dry place",
            manufacturerAddress: "Plot 4, Industrial Area, Ludhiana, Punjab",
            allergens: [],
            attributes: [{ name: "Grain", value: "Long" }],
            nutrition: NUTRITION_TABLE_EN,
            keywords: ["chawal"],
            seoTitle: "Organic Basmati Rice 1kg & 5kg | Green Farms",
            seoDescription: "Aged 24 months, naturally grown basmati.",
            searchText:
                "organic basmati rice green farms chawal rice-1kg rice-5kg",
        },
    ],
    options: [
        {
            id: "301",
            productId: "101",
            optionGroupId: "7",
            position: 0,
            optionGroup: {
                id: "7",
                code: "pack-size",
                name: { en: "Pack size" },
                valueType: "TEXT",
                isFilterable: true,
            },
        },
    ],
    variants: [
        {
            id: "501",
            productId: "101",
            sku: "RICE-1KG",
            optionHash: "21",
            mrp: "120.00",
            unit: "KG",
            unitValue: "1",
            weightGrams: 1050,
            position: 0,
            isActive: true,
            audioMediaId: null,
            barcodes: [
                {
                    id: "9001",
                    variantId: "501",
                    code: "8901234567892",
                    type: "EAN13",
                    isPrimary: true,
                },
            ],
            optionValues: [
                {
                    variantId: "501",
                    optionGroupId: "7",
                    optionValueId: "21",
                    imageId: null,
                    optionValue: {
                        id: "21",
                        code: "1kg",
                        label: { en: "1 kg" },
                    },
                },
            ],
            media: [],
        },
    ],
    media: [{ id: "7001", productId: "101", mediaId: "880", position: 0 }],
    brand: { id: "5", slug: "green-farms", status: "ACTIVE" },
    category: { id: "12", slug: "rice-grains", status: "ACTIVE" },
};

const ADMIN_LIST_ITEM = {
    id: "101",
    slug: "organic-basmati-rice",
    title: "Organic Basmati Rice",
    status: "PUBLISHED",
    categoryId: "12",
    categoryName: "Rice & Grains",
    brandId: "5",
    brandName: "Green Farms",
    isVariable: true,
    variantCount: 2,
    thumbnailId: "880",
    thumbnailUrl: "https://cdn.example.com/media/880/thumb.webp",
    // variable product: lowest - highest MRP
    price: {
        type: "range",
        min: "₹120.00",
        max: "₹550.00",
        label: "₹120.00 - ₹550.00",
    },
    variants: [
        {
            id: "501",
            sku: "RICE-1KG",
            mrp: "₹120.00",
            isActive: true,
            barcode: "8901234567892",
        },
        {
            id: "502",
            sku: "RICE-5KG",
            mrp: "₹550.00",
            isActive: true,
            barcode: null,
        },
    ],
    updatedAt: "2026-10-01T09:30:00.000Z",
    deletedAt: null,
};

// ============ admin responses ============

export const EXAMPLES = {
    /** GET admin/products (live products) */
    adminList: {
        currency: CURRENCY,
        items: [
            ADMIN_LIST_ITEM,
            {
                ...ADMIN_LIST_ITEM,
                id: "102",
                slug: "calling-bell-classic",
                title: "Calling Bell Classic",
                isVariable: false,
                variantCount: 1,
                // simple product: its MRP
                price: { type: "single", mrp: "₹349.00", label: "₹349.00" },
                variants: [
                    {
                        id: "510",
                        sku: "CALLING-BELL-CLASSIC",
                        mrp: "₹349.00",
                        isActive: true,
                        barcode: null,
                    },
                ],
            },
        ],
        total: 2,
        page: 1,
        limit: 20,
    },

    /** GET admin/products?deleted=true */
    trashList: {
        currency: CURRENCY,
        items: [
            {
                ...ADMIN_LIST_ITEM,
                status: "ARCHIVED",
                slug: "organic-basmati-rice-del-101",
                deletedAt: "2026-10-10T08:00:00.000Z",
            },
        ],
        total: 1,
        page: 1,
        limit: 20,
    },

    /** GET admin/products/counts */
    counts: { all: 42, DRAFT: 7, PUBLISHED: 33, ARCHIVED: 2, trash: 3 },

    /** GET admin/products/check-slug when the slug is free */
    checkSlugAvailable: {
        exists: false,
        slug: "organic-basmati-rice",
        suggestion: null,
    },

    /** GET admin/products/check-slug when the slug is taken */
    checkSlugTaken: {
        exists: true,
        slug: "organic-basmati-rice",
        suggestion: "organic-basmati-rice-2",
    },

    /** GET admin/products/check-sku */
    checkSku: { exists: true, sku: "RICE-1KG", suggestion: "RICE-1KG-2" },

    /** POST admin/products/generate-skus */
    generatedSkus: {
        skus: ["ORGANIC-BASMATI-RICE-1KG", "ORGANIC-BASMATI-RICE-5KG"],
    },

    /** GET admin/products/manufacturer-suggestions */
    manufacturerSuggestions: {
        items: [
            {
                name: "Green Farms Pvt Ltd",
                address: "Plot 4, Industrial Area, Ludhiana, Punjab",
            },
        ],
    },

    /** POST admin/products/bulk/* and PATCH admin/products/bulk */
    bulkResult: {
        succeeded: ["101", "102"],
        failed: [
            {
                id: "103",
                message:
                    "A category is required to publish; Select a value for every option on: TEA-250G",
            },
        ],
    },

    /** GET products/:id, POST products, PATCH products/:id, PATCH products/:id/options|quick */
    adminProduct: ADMIN_PRODUCT,

    /** DELETE products/:id/purge */
    successWithId: { success: true, id: "101" },

    /** DELETE products/:id, PATCH variants/:id, DELETE variants/:id */
    successOnly: { success: true },

    /** PATCH products/:id/status { status } */
    statusChanged: {
        success: true,
        id: "101",
        status: "PUBLISHED",
        changed: true,
        previousStatus: "DRAFT",
        publishedAt: "2026-10-19T04:10:00.000Z",
        updatedAt: "2026-10-19T04:10:00.000Z",
    },

    /** PATCH products/:id/status with the status the product already has */
    statusUnchanged: {
        success: true,
        id: "101",
        status: "PUBLISHED",
        changed: false,
        previousStatus: "PUBLISHED",
        publishedAt: "2026-10-01T09:30:00.000Z",
        updatedAt: "2026-10-01T09:30:00.000Z",
    },

    /** POST products/:id/restore */
    restored: { success: true, id: "101", restored: true },

    /** POST products/:id/variants */
    createdVariant: {
        id: "502",
        productId: "101",
        sku: "RICE-5KG",
        optionHash: "22",
        mrp: "550.00",
        unit: "KG",
        unitValue: "5",
        weightGrams: 5100,
        position: 1,
        isActive: true,
        deletedAt: null,
        createdAt: "2026-10-13T07:15:00.000Z",
        updatedAt: "2026-10-13T07:15:00.000Z",
    },

    // ============ storefront responses ============

    /** GET catalog/products */
    storefrontList: {
        items: [
            {
                productId: "101",
                currency: CURRENCY,
                slug: "organic-basmati-rice",
                title: "Organic Basmati Rice",
                shortDescription: "Aged long-grain basmati rice",
                thumbnailUrl: "https://cdn.example.com/media/880/thumb.webp",
                brand: "Green Farms",
                dietType: "VEG",
                variants: [
                    {
                        variantId: "501",
                        sku: "RICE-1KG",
                        label: "1 kg",
                        price: "₹108.00",
                        mrp: "₹120.00",
                        discountPct: 10,
                        inStock: true,
                        unit: "KG",
                        unitValue: "1",
                    },
                ],
            },
        ],
        page: 1,
        hasMore: false,
    },

    /** GET catalog/products/:slug?storeId=... */
    storefrontDetail: {
        id: "101",
        slug: "organic-basmati-rice",
        isVariable: true,
        title: "Organic Basmati Rice",
        shortDescription: "Aged long-grain basmati rice",
        description: "Premium aged basmati, naturally grown.",
        keyFeatures: [{ name: "Aged", value: "24 months" }],
        ingredients: "Basmati rice",
        storageInstructions: "Store in a cool, dry place",
        allergens: [],
        attributes: [{ name: "Grain", value: "Long" }],
        seo: {
            title: "Organic Basmati Rice 1kg & 5kg | Green Farms",
            description: "Aged 24 months, naturally grown basmati.",
        },
        brand: { id: "5", name: "Green Farms" },
        category: { id: "12", name: "Rice & Grains", slug: "rice-grains" },
        dietType: "VEG",
        countryOfOrigin: "IN",
        nutrition: {
            meta: { basis: "PER_100G", servingSize: "30g" },
            table: NUTRITION_TABLE_EN,
        },
        manufacturerName: "Green Farms Pvt Ltd",
        manufacturerAddress: "Plot 4, Industrial Area, Ludhiana, Punjab",
        shelfLifeDays: 365,
        audioUrl: null,
        options: [{ id: "7", code: "pack-size", name: "Pack size" }],
        images: [
            { id: "880", url: "https://cdn.example.com/media/880/master.webp" },
        ],
        currency: CURRENCY,
        variants: [
            {
                id: "501",
                sku: "RICE-1KG",
                unit: "KG",
                unitValue: "1",
                weightGrams: 1050,
                barcode: "8901234567892",
                optionValueIds: ["21"],
                optionImages: [],
                label: "1 kg",
                images: [],
                audioUrl: null,
                price: "₹108.00",
                mrp: "₹120.00",
                inStock: true,
                maxQty: 10,
                minQty: 1,
            },
        ],
    },
};

// ============ error responses ============

export const ERRORS = {
    productNotFound: errorExample(404, "Not Found", "Product not found"),
    trashNotFound: errorExample(
        404,
        "Not Found",
        "Product not found in the deleted list",
    ),
    variantNotFound: errorExample(404, "Not Found", "Variant not found"),
    validation: errorExample(
        400,
        "Bad Request",
        "A product without option types must have exactly one variant",
    ),
    publishBlocked: errorExample(400, "Bad Request", [
        "A category is required to publish",
        "A title in the default language (en) is required",
        "Select a value for every option on: TEA-250G",
    ]),
    barcodeInvalid: errorExample(
        400,
        "Bad Request",
        "Barcode 8901234567890 is not a valid EAN13",
    ),
    slugTaken: errorExample(
        409,
        "Conflict",
        "This product slug is already in use",
    ),
    skuExists: errorExample(409, "Conflict", "SKU RICE-1KG already exists"),
    staleUpdate: errorExample(
        409,
        "Conflict",
        "This product was changed by someone else. Reload it and try again.",
    ),
    purgeInUse: errorExample(
        409,
        "Conflict",
        "Product is still referenced (for example by orders) and cannot be permanently deleted",
    ),
    restoreConflict: errorExample(
        409,
        "Conflict",
        "The original slug is now used by another product",
    ),
    slugInputRequired: errorExample(
        400,
        "Bad Request",
        "Send a title or a slug",
    ),
    slugInvalid: errorExample(
        400,
        "Bad Request",
        "The slug contains no usable characters",
    ),
    storeIdRequired: errorExample(400, "Bad Request", "storeId is required"),
};

// ============ store manager: own product / variant photos ============

export class StoreProductMediaBodyDoc {
    @ApiProperty({
        type: [String],
        example: ["812", "813"],
        description: "READY images with purpose PRODUCT that you uploaded (POST /account/media). Appended in this order.",
    })
    mediaIds!: string[];

    @ApiPropertyOptional({ example: "77", description: "Add to this variant instead of the product gallery" })
    variantId?: string;
}

export class StoreProductMediaAddResponse {
    @ApiProperty({ example: "512" })
    productId!: string;

    @ApiProperty({ type: String, nullable: true, example: null })
    variantId!: string | null;

    @ApiProperty({ type: [String], example: ["812", "813"], description: "Newly attached" })
    added!: string[];

    @ApiProperty({ type: [String], example: [], description: "Already attached, left as they were" })
    skipped!: string[];
}

export class StoreProductMediaRemoveResponse {
    @ApiProperty({ example: true })
    success!: boolean;

    @ApiProperty({ example: "512" })
    productId!: string;

    @ApiProperty({ example: "812" })
    mediaId!: string;

    @ApiProperty({ example: 1, description: "Links removed (gallery + variants)" })
    removed!: number;
}

const mediaError = (status: number, error: string, message: string) => ({
    schema: { example: errorExample(status, error, message) },
});

/** POST /store/catalog/products/:id/media */
export const ApiStoreAddProductMedia = () =>
    applyDecorators(
        ApiOperation({
            summary: "Add my photos to a product or variant",
            description:
                "Store managers (`product.media`). Upload the images first with POST /account/media (purpose PRODUCT, images only), " +
                "then attach them here. Photos are appended; existing photos — including other people's — are never moved " +
                "or removed. A product without a thumbnail gets the first new photo. Gallery max 15, variant max 10.",
        }),
        ApiParam({ name: "id", description: "Product id", example: "512" }),
        ApiBody({ type: StoreProductMediaBodyDoc }),
        ApiOkResponse({ type: StoreProductMediaAddResponse }),
        ApiBadRequestResponse({
            description:
                "Media not found, not a READY PRODUCT image (`catalog.media.notProductImage`), or limit reached (`galleryLimit` / `variantLimit`)",
            ...mediaError(400, "Bad Request", "Only READY images uploaded with purpose PRODUCT can be added."),
        }),
        ApiForbiddenResponse({
            description: "A photo was uploaded by someone else (`catalog.media.notYours`)",
            ...mediaError(403, "Forbidden", "You can only add or remove photos you uploaded."),
        }),
        ApiNotFoundResponse({ description: "Product not PUBLISHED / not found, or variant not in this product", ...mediaError(404, "Not Found", "Product not found") }),
    );

/** DELETE /store/catalog/products/:id/media/:mediaId */
export const ApiStoreRemoveProductMedia = () =>
    applyDecorators(
        ApiOperation({
            summary: "Remove one of my photos from a product",
            description:
                "Store managers (`product.media`). Detaches a photo you uploaded from the product gallery and all of its variants. " +
                "Photos uploaded by others cannot be removed. If it was the thumbnail, the next gallery image takes over. " +
                "The file stays in your media library (delete it there if no longer needed).",
        }),
        ApiParam({ name: "id", description: "Product id", example: "512" }),
        ApiParam({ name: "mediaId", example: "812" }),
        ApiOkResponse({ type: StoreProductMediaRemoveResponse }),
        ApiForbiddenResponse({ description: "Photo uploaded by someone else (`catalog.media.notYours`)", ...mediaError(403, "Forbidden", "You can only add or remove photos you uploaded.") }),
        ApiNotFoundResponse({ description: "Product not found, or the photo is not attached (`catalog.media.notInProduct`)", ...mediaError(404, "Not Found", "This photo is not attached to the product.") }),
    );
