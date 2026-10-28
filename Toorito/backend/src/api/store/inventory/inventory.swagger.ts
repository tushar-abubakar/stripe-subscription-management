/**
 * Swagger / OpenAPI documentation for the inventory module.
 *
 * Each endpoint gets ONE composed decorator (`@ApiXxx()`) with summary,
 * params, body examples, a typed success response with example and the
 * errors the service can throw. Request validation stays in
 * `inventory.dto.ts` (those classes also carry `@ApiProperty`).
 *
 * Bigint ids are serialized as numeric strings; money is a MoneyView
 * object `{ amount, currency, symbol, formatted }`.
 */
import { applyDecorators } from "@nestjs/common";
import {
    ApiBadRequestResponse,
    ApiBearerAuth,
    ApiBody,
    ApiConflictResponse,
    ApiCreatedResponse,
    ApiForbiddenResponse,
    ApiHeader,
    ApiNotFoundResponse,
    ApiOkResponse,
    ApiOperation,
    ApiParam,
    ApiProperty,
    ApiPropertyOptional,
    ApiTags,
    ApiUnauthorizedResponse,
} from "@nestjs/swagger";
import { StoreListingStatus, StorePriceStatus } from "@prisma-client/enums";
import {
    AdjustStockDto,
    BatchStatusDto,
    BulkPriceDto,
    CatalogChangeRequestDto,
    ListOnStoreDto,
    ListProductOnStoreDto,
    ReceiveGoodsDto,
    StockOutDto,
    BulkListingStatusDto,
    EndFlashSaleDto,
    FlashSaleDto,
    GrnEditRequestDto,
    ListingStatusDto,
    ProposeBarcodesDto,
    UpdateListingDto,
} from "./inventory.dto";

// =====================================================================
// Shared fragments
// =====================================================================

const BIGINT_ID = { type: String, pattern: "^\\d+$" } as const;

const money = (amount: number) => ({
    amount,
    currency: "BDT",
    symbol: "৳",
    formatted: `৳${amount.toFixed(2)}`,
});

const CURRENCY = { code: "BDT", symbol: "৳" };

function errorSchema(statusCode: number, error: string, message: string | string[], code?: string) {
    return {
        type: "object",
        properties: {
            statusCode: { type: "number", example: statusCode },
            message: {
                oneOf: [{ type: "string" }, { type: "array", items: { type: "string" } }],
                example: message,
            },
            error: { type: "string", example: error },
            ...(code && { code: { type: "string", example: code } }),
        },
    };
}

const causes = (title: string, list: string[]) =>
    `${title}\n\nPossible causes:\n${list.map((c) => `- ${c}`).join("\n")}`;

const ACCEPT_LANGUAGE = ApiHeader({
    name: "Accept-Language",
    required: false,
    description: "Language of titles / labels and error messages (falls back to the default language)",
    example: "en",
});

const AUTH_ERRORS = (forbidden: string) =>
    applyDecorators(
        ApiBearerAuth(),
        ApiUnauthorizedResponse({
            description: "Missing, invalid or expired bearer token",
            schema: errorSchema(401, "Unauthorized", "Unauthorized"),
        }),
        ApiForbiddenResponse({
            description: forbidden,
            schema: errorSchema(403, "Forbidden", "Forbidden resource"),
        }),
    );

const idParam = (name: string, what: string, example: string) =>
    ApiParam({ name, description: `${what} (bigint as numeric string)`, schema: { type: "string", pattern: "^\\d+$" }, example });

const STORE_ID = idParam("storeId", "Store ID — admin routes act on this store", "7");
const LISTING_ID = idParam("id", "Store listing (StoreProduct) ID", "88");
const PRODUCT_ID = idParam("productId", "Catalogue product ID", "345");
const VARIANT_ID = idParam("variantId", "Catalogue variant ID", "1202");

const VALIDATION = (example: string) =>
    ApiBadRequestResponse({
        description: "Body / query validation failed",
        schema: errorSchema(400, "Bad Request", [example]),
    });

const LISTING_NOT_FOUND = ApiNotFoundResponse({
    description: "Listing not found in this store (`inventory.errors.notFound`)",
    schema: errorSchema(404, "Not Found", "Not found"),
});

const STATUS_RULES =
    "Statuses: DRAFT (prepared, never shown), SCHEDULED (goes ACTIVE automatically at `publishAt`, checked every minute), " +
                "ACTIVE (live), INACTIVE (switched off). ACTIVE / SCHEDULED need the admin catalogue item to be live (PUBLISHED product, " +
                "active variant) — otherwise 400 CATALOG_NOT_LIVE. `publishAt` must be at least 1 minute ahead. Stock, price and history are " +
                "kept in every status. ";

const STATUS_ERRORS = [
    "ACTIVE / SCHEDULED while the catalogue item is not live (`variantInactive`, code CATALOG_NOT_LIVE)",
    "SCHEDULED without `publishAt` (code PUBLISH_AT_REQUIRED) or with a time less than 1 minute ahead (code PUBLISH_AT_PAST)",
];

const IdParam = (name: string, what: string, example: string) => idParam(name, what, example);

const PRICE_ABOVE_MRP = "Selling price above the admin MRP / batch MRP (`priceAboveMrp`, code PRICE_ABOVE_MRP)";

// =====================================================================
// Response models
// =====================================================================

export class MoneyDoc {
    @ApiProperty({ example: 52 }) amount!: number;
    @ApiProperty({ example: "BDT" }) currency!: string;
    @ApiProperty({ example: "৳" }) symbol!: string;
    @ApiProperty({ example: "৳52.00" }) formatted!: string;
}

export class CurrencyDoc {
    @ApiProperty({ example: "BDT" }) code!: string;
    @ApiProperty({ example: "৳" }) symbol!: string;
}

export class SuccessDoc {
    @ApiProperty({ example: true }) success!: boolean;
}

export class ListingDoc {
    @ApiProperty({ ...BIGINT_ID, example: "88" }) id!: string;
    @ApiProperty({ ...BIGINT_ID, example: "7" }) storeId!: string;
    @ApiProperty({ ...BIGINT_ID, example: "345" }) productId!: string;
    @ApiProperty({ ...BIGINT_ID, example: "1201" }) variantId!: string;
    @ApiProperty({ ...BIGINT_ID, example: "12" }) categoryId!: string;
    @ApiProperty({ example: "Amul Taaza Toned Milk" }) title!: string;
    @ApiPropertyOptional({ example: "500 ml", nullable: true }) variantLabel!: string | null;
    @ApiPropertyOptional({ example: "https://cdn.example.com/p/345/thumb.webp", nullable: true }) thumbnailUrl!: string | null;
    @ApiProperty({ type: MoneyDoc }) sellingPrice!: MoneyDoc;
    @ApiPropertyOptional({ type: MoneyDoc, nullable: true, description: "MRP printed on the batch being sold" }) currentMrp!: MoneyDoc | null;
    @ApiProperty({ enum: StorePriceStatus, example: "CUSTOM", description: "MRP_RESET = admin lowered MRP, the store price was discarded" })
    priceStatus!: string;
    @ApiPropertyOptional({ example: null, nullable: true, format: "date-time" }) priceResetAt!: string | null;
    @ApiProperty({ example: 40 }) availableQty!: number;
    @ApiProperty({ example: 3 }) reservedQty!: number;
    @ApiProperty({ example: 37, description: "availableQty - reservedQty" }) sellable!: number;
    @ApiProperty({ example: 5 }) lowStockThreshold!: number;
    @ApiProperty({ example: false }) lowStock!: boolean;
    @ApiProperty({ example: false }) outOfStock!: boolean;
    @ApiProperty({ example: 1 }) minOrderQty!: number;
    @ApiPropertyOptional({ example: 6, nullable: true }) maxOrderQty!: number | null;
    @ApiProperty({ example: true }) trackBatches!: boolean;
    @ApiProperty({ example: 2 }) minSellableDays!: number;
    @ApiPropertyOptional({ example: "A-03-2", nullable: true }) shelfLocation!: string | null;
    @ApiProperty({ enum: StoreListingStatus, example: "ACTIVE", description: "Store lifecycle: DRAFT / SCHEDULED / ACTIVE / INACTIVE" })
    status!: string;
    @ApiPropertyOptional({ format: "date-time", nullable: true, example: null, description: "SCHEDULED only: when it goes ACTIVE" })
    publishAt!: string | null;
    @ApiProperty({ example: true, description: "Raw live flag (same as isLive)" }) isActive!: boolean;
    @ApiProperty({ example: true, description: "Visible & sellable on the storefront now = status ACTIVE and catalogue live" }) isLive!: boolean;
    @ApiProperty({ example: false, description: "ACTIVE but hidden because the admin unpublished / disabled the catalogue item" }) catalogBlocked!: boolean;
    @ApiProperty({
        type: Object,
        description: "Store-side copy of the catalogue (StoreProductSnapshot). The global product is never edited by stores.",
        example: {
            version: 1, productId: "345", variantId: "1201", slug: "amul-taaza-toned-milk",
            title: { en: "Amul Taaza Toned Milk" }, brand: { id: "4", name: { en: "Amul" } },
            category: { id: "12", name: { en: "Milk" } }, thumbnailId: "901", sku: "AMUL-TAAZA-500",
            options: [{ group: "size", groupName: { en: "Size" }, value: "500ml", label: { en: "500 ml" } }],
            unit: "ML", unitValue: 500, weightGrams: 520, mrp: 56, gstRate: 5, hsnCode: "0401",
            dietType: "VEG", isPerishable: true, shelfLifeDays: 3, barcodes: ["8901262010016"],
            capturedAt: "2026-10-20T04:10:00.000Z",
        },
    })
    snapshot!: Record<string, unknown>;
    @ApiProperty({ format: "date-time", example: "2026-10-20T04:10:00.000Z" }) snapshotAt!: string;
    @ApiProperty({ example: false, description: "Catalogue changed after the snapshot (call resync-snapshot)" }) snapshotOutdated!: boolean;
    @ApiProperty({ example: { sku: "AMUL-TAAZA-500", mrp: money(56), isActive: true } }) variant!: Record<string, unknown>;
    @ApiProperty({ example: { slug: "amul-taaza-toned-milk", status: "PUBLISHED" } }) product!: Record<string, unknown>;
}

export class ListingPageDoc {
    @ApiProperty({ type: CurrencyDoc }) currency!: CurrencyDoc;
    @ApiProperty({ type: [ListingDoc] }) items!: ListingDoc[];
    @ApiProperty({ example: 132 }) total!: number;
    @ApiProperty({ example: 1 }) page!: number;
    @ApiProperty({ example: 20 }) limit!: number;
}

export class ProductVariantRowDoc {
    @ApiProperty({ ...BIGINT_ID, example: "1201" }) variantId!: string;
    @ApiProperty({ example: "AMUL-TAAZA-500" }) sku!: string;
    @ApiPropertyOptional({ example: "500 ml", nullable: true }) label!: string | null;
    @ApiPropertyOptional({ example: "ML", nullable: true }) unit!: string | null;
    @ApiPropertyOptional({ example: "500", nullable: true }) unitValue!: string | null;
    @ApiProperty({ type: MoneyDoc, description: "Admin MRP" }) mrp!: MoneyDoc;
    @ApiProperty({ example: true, description: "Admin catalogue switch" }) catalogActive!: boolean;
    @ApiPropertyOptional({ type: ListingDoc, nullable: true, description: "null = not listed on this store" }) listing!: ListingDoc | null;
}

export class ProductListingDoc {
    @ApiProperty({ type: CurrencyDoc }) currency!: CurrencyDoc;
    @ApiProperty({
        example: {
            id: "345", slug: "amul-taaza-toned-milk", status: "PUBLISHED", title: "Amul Taaza Toned Milk",
            thumbnailUrl: "https://cdn.example.com/p/345/thumb.webp", brand: { id: "4", name: "Amul" },
            category: { id: "12", name: "Milk" }, isVariable: true,
        },
    })
    product!: Record<string, unknown>;
    @ApiProperty({ example: { variants: 3, listed: 2, live: 1, byStatus: { DRAFT: 0, SCHEDULED: 1, ACTIVE: 1, INACTIVE: 0 }, priceAlerts: 0 } }) summary!: Record<string, unknown>;
    @ApiProperty({ type: [ProductVariantRowDoc] }) variants!: ProductVariantRowDoc[];
}

export class CatalogItemDoc {
    @ApiProperty({ ...BIGINT_ID, example: "345" }) id!: string;
    @ApiProperty({ example: "amul-taaza-toned-milk" }) slug!: string;
    @ApiProperty({ example: "Amul Taaza Toned Milk" }) title!: string;
    @ApiPropertyOptional({ example: "https://cdn.example.com/p/345/thumb.webp", nullable: true }) thumbnailUrl!: string | null;
    @ApiPropertyOptional({ example: { id: "4", name: "Amul" }, nullable: true }) brand!: Record<string, string> | null;
    @ApiPropertyOptional({ example: { id: "12", name: "Milk" }, nullable: true }) category!: Record<string, string> | null;
    @ApiProperty({ example: true }) isVariable!: boolean;
    @ApiProperty({ example: 3 }) variantCount!: number;
    @ApiPropertyOptional({ example: { min: money(28), max: money(110) }, nullable: true }) mrp!: Record<string, MoneyDoc> | null;
    @ApiProperty({ example: { listedVariants: 2, unlistedVariants: 1, byStatus: { DRAFT: 1, SCHEDULED: 0, ACTIVE: 1, INACTIVE: 0, PENDING_APPROVAL: 0 } } }) store!: Record<string, unknown>;
    @ApiProperty({
        description: "Every active catalogue variation with this store's listing (null = not listed)",
        example: [
            { id: "88", sku: "AMUL-500", mrp: money(56), listing: { id: "1201", status: "ACTIVE", isLive: true, sellingPrice: money(52), sellable: 61 } },
            { id: "90", sku: "AMUL-200", mrp: money(28), listing: null },
        ],
    })
    variants!: Record<string, unknown>[];
}

export class CatalogPageDoc {
    @ApiProperty({ type: CurrencyDoc }) currency!: CurrencyDoc;
    @ApiProperty({ type: [CatalogItemDoc] }) items!: CatalogItemDoc[];
    @ApiProperty({ example: 420 }) total!: number;
    @ApiProperty({ example: 1 }) page!: number;
    @ApiProperty({ example: 20 }) limit!: number;
}

const SUMMARY_EXAMPLE = {
    currency: CURRENCY,
    timezone: "Asia/Dhaka",
    listings: {
        total: 132,
        live: 117,
        byStatus: { DRAFT: 5, SCHEDULED: 4, ACTIVE: 118, INACTIVE: 5 },
        catalogBlocked: 1,
        outOfStock: 6,
        lowStock: 14,
        priceAlerts: 2,
    },
    units: { onHand: 5480, reserved: 63, sellable: 5417 },
    value: { retail: money(318200), cost: money(251020.5) },
    batches: { expiringSoon: 9, expiringWithinDays: 7, quarantined: 1 },
    today: {
        PURCHASE: { movements: 18, quantity: 640 },
        RESERVE: { movements: 54, quantity: 97 },
        SALE: { movements: 41, quantity: -88 },
        DAMAGE: { movements: 1, quantity: -2 },
    },
};

const MOVEMENT_EXAMPLE = {
    id: "90211", storeId: "7", storeProductId: "88", batchId: "412", type: "SALE", quantity: -2,
    balanceAfter: 38, batchBalanceAfter: 10, unitCost: null, orderItemId: "5510", refType: null, refId: null,
    idempotencyKey: null, actorId: "31", note: null, createdAt: "2026-10-20T05:22:11.000Z",
    listing: { id: "88", sku: "AMUL-TAAZA-500", title: "Amul Taaza Toned Milk" },
    actor: { id: "31", name: "Rafiq (picker)", role: "STORE_STAFF" },
};

const BATCH_EXAMPLE = {
    id: "412", storeProductId: "88", storeId: "7", variantId: "1201", batchNumber: "B2410A",
    manufacturedAt: "2026-10-18", expiryDate: "2026-10-23", shelfLifeDays: 5, mrp: money(56), costPrice: money(41.2),
    clearancePrice: null, receivedQty: 48, availableQty: 12, status: "ACTIVE", receivedAt: "2026-10-19T03:00:00.000Z",
    supplierName: "Fresh Dairy Distributors", note: null,
};

const GRN_EXAMPLE = {
    id: "77", grnNumber: "GRN-MGZ1A2B3C4", storeId: "7", supplierName: "Fresh Dairy Distributors",
    supplierPhone: "+8801711000000", supplierInvoiceNo: "INV-55120", supplierInvoiceDate: "2026-10-19",
    receivedById: "12", receivedAt: "2026-10-20T03:05:00.000Z", note: null,
    items: [
        {
            id: "301", goodsReceiptId: "77", storeProductId: "88", variantId: "1201", batchNumber: "B2410A",
            manufacturedAt: "2026-10-18", expiryDate: "2026-10-23", shelfLifeDays: 5, receivedQty: 48, rejectedQty: 2,
            costPrice: "41.20", mrp: "56.00", batchId: "412",
        },
    ],
};

// =====================================================================
// Controller-level
// =====================================================================

export const ApiStoreInventoryController = () =>
    applyDecorators(
        ApiTags("StoreInventory"),
        ACCEPT_LANGUAGE,
        AUTH_ERRORS("Not STORE_MANAGER / STORE_STAFF, permission missing, no store assigned, or a manager-only action"),
    );

export const ApiAdminInventoryController = () =>
    applyDecorators(
        ApiTags("AdminInventory"),
        ACCEPT_LANGUAGE,
        AUTH_ERRORS("Not ADMIN / SUPER_ADMIN or the `inventory.*` permission is missing"),
    );

/** Adds the `:storeId` param to an admin route. */
export const ApiAdminStore = () => STORE_ID;

// =====================================================================
// Read endpoints
// =====================================================================

export const ApiInventorySummary = () =>
    applyDecorators(
        ApiOperation({
            summary: "Stock dashboard of the store",
            description:
                "Requires `inventory.read`. Listing counts (active / out of stock / low stock / price alerts), units on hand vs reserved, " +
                "stock value at selling price and at cost (active batches), expiring & quarantined batches, and today's stock flow by movement " +
                "type (store-local day; negative quantity = stock leaving).",
        }),
        ApiOkResponse({ description: "Summary", schema: { example: SUMMARY_EXAMPLE } }),
    );

export const ApiInventoryCatalog = () =>
    applyDecorators(
        ApiOperation({
            summary: "Browse the admin catalogue to pick products",
            description:
                "Requires `inventory.read`. Only PUBLISHED products added by admins. Each item tells how many of its variants this store " +
                "has listed (by status) / not yet listed, and `variants[]` groups every variation with this store's listing (`listing: null` = not listed). " +
                "Filters: `q`, `categoryId`, `brandId`, `listed`, `status` (any variation in that listing status), `stock=in|out`. Sort: `newest` (default), `oldest`, `name`, `updated`. " +
                "Use `listed=unlisted` for products with nothing listed yet, `listed=to_add` for products with any variation still to add. " +
                "`categoryIds` / `brandIds` take several ids (comma separated; categories include sub-categories) — get them from `…/catalog/categories` and `…/catalog/brands`.",
        }),
        ApiOkResponse({ description: "One page of catalogue products", type: CatalogPageDoc }),
        VALIDATION("listed must be one of the following values: all, listed, unlisted"),
    );

export const ApiInventoryProduct = () =>
    applyDecorators(
        ApiOperation({
            summary: "One product with all its variations and this store's listing for each",
            description:
                "Requires `inventory.read`. `listing: null` = variation not listed yet. Drives the 'enable / disable variations' screen. " +
                "`product.gallery` and each variation's `media` list the catalogue's images / videos / audio (`type`, `url`, `thumbUrl`) — view only; " +
                "ask for changes with `POST …/products/{productId}/change-requests` (listed under `changeRequests`). " +
                "Each variation has `barcodes { approved[], pending[], rejected[] }`: catalogue codes, codes this store proposed that wait for the admin " +
                "(with `approvalId`; withdraw with `POST /store/approvals/{approvalId}/cancel`), and proposals rejected in the last 30 days with the admin's `reviewNote`. " +
                "Add codes to one variation with `POST /store/inventory/listings/{listingId}/barcodes`.",
        }),
        PRODUCT_ID,
        ApiOkResponse({ description: "Product + variations", type: ProductListingDoc }),
        ApiNotFoundResponse({ description: "Product missing / deleted (`productNotAvailable`)", schema: errorSchema(404, "Not Found", "Product is not available for listing") }),
    );

export const ApiInventoryListings = () =>
    applyDecorators(
        ApiOperation({
            summary: "List store listings (stock list)",
            description:
                "Requires `inventory.read`. Filters: `q` (title / SKU), `categoryId`, `productId`, `stock` (in | low | out | reserved), " +
                "`priceStatus` (MRP_RESET = needs re-pricing), `status` (DRAFT | SCHEDULED | ACTIVE | INACTIVE), `isActive` (live now).",
        }),
        ApiOkResponse({ description: "One page of listings", type: ListingPageDoc }),
        VALIDATION("stock must be one of the following values: in, low, out, reserved"),
    );

export const ApiInventoryListing = () =>
    applyDecorators(
        ApiOperation({
            summary: "Get one listing",
            description:
                "Requires `inventory.read`. Adds `barcodes { approved[], pending[], rejected[] }` for this variation " +
                "(catalogue codes / codes waiting for the admin with `approvalId` / rejected in the last 30 days with `reviewNote`).",
        }),
        LISTING_ID,
        ApiOkResponse({ description: "Listing", type: ListingDoc }),
        LISTING_NOT_FOUND,
    );

export const ApiInventoryBatches = () =>
    applyDecorators(
        ApiOperation({ summary: "Batches of a listing (FEFO order)", description: "Requires `inventory.read`. Earliest expiry first." }),
        LISTING_ID,
        ApiOkResponse({ description: "Batches", schema: { example: [BATCH_EXAMPLE] } }),
    );

export const ApiInventoryListingMovements = () =>
    applyDecorators(
        ApiOperation({ summary: "Stock movements of one listing", description: "Requires `inventory.read`. Newest first, paginated (array)." }),
        LISTING_ID,
        ApiOkResponse({ description: "Movements", schema: { example: [{ ...MOVEMENT_EXAMPLE, listing: undefined, actor: undefined }] } }),
    );

export const ApiInventoryPriceHistory = () =>
    applyDecorators(
        ApiOperation({
            summary: "Price history of a listing",
            description:
                "Requires `inventory.read`. Reasons: MANUAL (store / admin edit), NEW_BATCH_MRP (clamped to a batch MRP), " +
                "CATALOG_MRP_REDUCED (admin lowered the MRP below the store price — the store price was discarded).",
        }),
        LISTING_ID,
        ApiOkResponse({
            description: "History page",
            schema: {
                example: {
                    currency: CURRENCY,
                    items: [
                        {
                            id: "5001", storeProductId: "88", oldPrice: money(54), newPrice: money(50), oldMrp: money(56),
                            newMrp: money(56), reason: "CATALOG_MRP_REDUCED", changedById: "2", createdAt: "2026-10-20T06:00:00.000Z",
                        },
                    ],
                    total: 4, page: 1, limit: 20,
                },
            },
        }),
        LISTING_NOT_FOUND,
    );

export const ApiInventoryLedger = () =>
    applyDecorators(
        ApiOperation({
            summary: "Store-wide stock ledger",
            description:
                "Requires `inventory.read`. Every stock event: PURCHASE (stock in), RESERVE / RELEASE (checkout / cancel), SALE (packed), " +
                "RETURN, ADJUSTMENT, DAMAGE, EXPIRED, LOST, VENDOR_RETURN. `from` / `to` are calendar days in the store timezone. " +
                "`types` accepts a comma separated list.",
        }),
        ApiOkResponse({ description: "Ledger page", schema: { example: { items: [MOVEMENT_EXAMPLE], total: 1840, page: 1, limit: 20 } } }),
        VALIDATION("each value in types must be one of the following values: PURCHASE, RESERVE, ..."),
    );

export const ApiInventoryReceipts = () =>
    applyDecorators(
        ApiOperation({ summary: "Goods receipts (GRN) — stock-in history", description: "Requires `inventory.read`. Search by GRN no, supplier or invoice." }),
        ApiOkResponse({
            description: "GRN page",
            schema: {
                example: {
                    currency: CURRENCY,
                    items: [{ ...GRN_EXAMPLE, items: undefined, lines: 6, receivedUnits: 220, rejectedUnits: 4, costTotal: money(8840) }],
                    total: 51, page: 1, limit: 20,
                },
            },
        }),
    );

export const ApiInventoryReceipt = () =>
    applyDecorators(
        ApiOperation({ summary: "One goods receipt with its lines", description: "Requires `inventory.read`." }),
        idParam("id", "Goods receipt ID", "77"),
        ApiOkResponse({
            description: "GRN",
            schema: {
                example: {
                    currency: CURRENCY,
                    ...GRN_EXAMPLE,
                    items: [{ ...GRN_EXAMPLE.items[0], sku: "AMUL-TAAZA-500", title: "Amul Taaza Toned Milk", mrp: money(56), costPrice: money(41.2) }],
                },
            },
        }),
        ApiNotFoundResponse({ description: "`receiptNotFound`", schema: errorSchema(404, "Not Found", "Goods receipt not found") }),
    );

export const ApiInventoryExpiring = () =>
    applyDecorators(
        ApiOperation({ summary: "Active batches expiring soon", description: "Requires `inventory.read`. `days` default / max come from config." }),
        ApiOkResponse({ description: "Batches", schema: { example: [{ ...BATCH_EXAMPLE, mrp: "56.00", costPrice: "41.20", storeProduct: { productId: "345", variantId: "1201", variant: { sku: "AMUL-TAAZA-500" } } }] } }),
    );

export const ApiInventoryScan = () =>
    applyDecorators(
        ApiOperation({ summary: "Barcode lookup", description: "Requires `inventory.read`. Resolves a barcode to the catalogue variant and this store's listing (if any)." }),
        ApiParam({ name: "code", example: "8901262010016" }),
        ApiOkResponse({
            description: "Barcode match",
            schema: {
                example: {
                    barcode: "8901262010016", variantId: "1201", sku: "AMUL-TAAZA-500", mrp: money(56), productId: "345",
                    titles: [{ lang: "en", title: "Amul Taaza Toned Milk" }],
                    listing: { id: "88", sellingPrice: money(52), availableQty: 40, reservedQty: 3, sellable: 37 },
                    currency: CURRENCY,
                },
            },
        }),
        ApiNotFoundResponse({ description: "Unknown barcode (code BARCODE_UNKNOWN)", schema: errorSchema(404, "Not Found", "Unknown barcode", "BARCODE_UNKNOWN") }),
    );

// =====================================================================
// Listing / pricing (manager or admin)
// =====================================================================

export const ApiListProduct = () =>
    applyDecorators(
        ApiOperation({
            summary: "List a catalogue product on the store (simple or with variations)",
            description:
                "Store manager / admin only, requires `inventory.write`. Pick an admin-created PUBLISHED product and send its variants: " +
                "a simple product has one, a variable product any subset — each with its own `sellingPrice` (<= admin MRP) and optional " +
                "`status` (default: the product-level `status`, else ACTIVE for new / unchanged for existing). New variants need `sellingPrice`; already-listed variants are updated in place (idempotent). Shared settings " +
                "(thresholds, order limits, batch tracking) apply to every line sent. A snapshot of the catalogue data is stored on each " +
                "listing; the original product is never modified. Returns the product view. " +
                STATUS_RULES,
        }),
        ApiBody({
            type: ListProductOnStoreDto,
            examples: {
                simple: {
                    summary: "Simple product",
                    value: { productId: 501, variants: [{ variantId: 1890, sellingPrice: 95 }], lowStockThreshold: 10 },
                },
                newBarcode: {
                    summary: "With a barcode the catalogue doesn't have (waits for admin)",
                    value: { productId: 501, variants: [{ variantId: 1890, sellingPrice: 95, barcodes: [{ code: "8941100500017", type: "EAN13" }] }] },
                },
                variable: {
                    summary: "Variable product: 2 sizes live, 1 size kept as draft",
                    value: {
                        productId: 345,
                        minSellableDays: 1,
                        maxOrderQty: 6,
                        variants: [
                            { variantId: 1201, sellingPrice: 52 },
                            { variantId: 1202, sellingPrice: 99 },
                            { variantId: 1203, sellingPrice: 190, status: "DRAFT" },
                        ],
                    },
                },
                draft: {
                    summary: "Whole product as draft",
                    value: { productId: 345, status: "DRAFT", variants: [{ variantId: 1201, sellingPrice: 52 }, { variantId: 1202, sellingPrice: 99 }] },
                },
                scheduled: {
                    summary: "Schedule launch",
                    value: { productId: 345, status: "SCHEDULED", publishAt: "2026-10-25T03:30:00.000Z", variants: [{ variantId: 1201, sellingPrice: 49 }] },
                },
            },
        }),
        ApiCreatedResponse({ description: "Product view after listing", type: ProductListingDoc }),
        ApiBadRequestResponse({
            description: causes("Invalid listing", [
                PRICE_ABOVE_MRP,
                "Variant not part of the product (`variantNotInProduct`)",
                "Same variant twice (`duplicateVariant`)",
                "New variant without price (`priceRequired`)",
                ...STATUS_ERRORS,
                "maxOrderQty < minOrderQty (`maxLtMin`)",
                "Barcode of another product (409 BARCODE_TAKEN / BARCODE_PENDING)",
                "Status change while waiting for admin approval (409 LISTING_AWAITING_APPROVAL)",
            ]),
            schema: errorSchema(400, "Bad Request", "Selling price cannot exceed MRP (56)", "PRICE_ABOVE_MRP"),
        }),
        ApiNotFoundResponse({ description: "Product not PUBLISHED / deleted (`productNotAvailable`)", schema: errorSchema(404, "Not Found", "Product is not available for listing") }),
    );

const STATUS_EXAMPLES = {
    activate: { summary: "Activate", value: { status: "ACTIVE" } },
    deactivate: { summary: "Deactivate", value: { status: "INACTIVE" } },
    draft: { summary: "Back to draft", value: { status: "DRAFT" } },
    schedule: { summary: "Schedule", value: { status: "SCHEDULED", publishAt: "2026-10-25T03:30:00.000Z" } },
};

const STATUS_BAD_REQUEST = ApiBadRequestResponse({
    description: causes("Status not allowed", STATUS_ERRORS),
    schema: errorSchema(400, "Bad Request", "publishAt must be at least 1 minute in the future", "PUBLISH_AT_PAST"),
});

export const ApiVariantStatus = () =>
    applyDecorators(
        ApiOperation({
            summary: "Set the status of one variation (draft / scheduled / active / inactive)",
            description: "Store manager / admin only. " + STATUS_RULES,
        }),
        PRODUCT_ID,
        VARIANT_ID,
        ApiBody({ type: ListingStatusDto, examples: STATUS_EXAMPLES }),
        ApiOkResponse({ description: "Product view", type: ProductListingDoc }),
        STATUS_BAD_REQUEST,
        ApiNotFoundResponse({ description: "Variant not listed on the store (`notListed`)", schema: errorSchema(404, "Not Found", "This product is not listed on your store") }),
    );

export const ApiResyncSnapshot = () =>
    applyDecorators(
        ApiOperation({
            summary: "Refresh the catalogue snapshot of a listed product",
            description:
                "Store manager / admin only. Copies the current catalogue data (title, options, MRP, barcodes, category...) into the " +
                "snapshot of every listing of the product. Price, stock and switches are untouched. Use when `snapshotOutdated` is true.",
        }),
        PRODUCT_ID,
        ApiOkResponse({ description: "Product view", type: ProductListingDoc }),
        ApiNotFoundResponse({ description: "`notListed`", schema: errorSchema(404, "Not Found", "This product is not listed on your store") }),
    );

export const ApiCreateListing = () =>
    applyDecorators(
        ApiOperation({
            summary: "List a single variant (shortcut)",
            description: "Store manager / admin only. Same rules as the product endpoint, for one variant. 409 if already listed (body carries `storeProductId`).",
        }),
        ApiBody({
            type: ListOnStoreDto,
            examples: {
                basic: { summary: "List 500 ml (ACTIVE)", value: { variantId: 1201, sellingPrice: 52, lowStockThreshold: 8, shelfLocation: "A-03-2" } },
                draft: { summary: "As draft", value: { variantId: 1201, sellingPrice: 52, status: "DRAFT" } },
            },
        }),
        ApiCreatedResponse({
            description: "Raw listing row",
            schema: { example: { id: "88", storeId: "7", variantId: "1201", productId: "345", sellingPrice: "52.00", currentMrp: "56.00", priceStatus: "CUSTOM", status: "ACTIVE", publishAt: null, availableQty: 0, reservedQty: 0, isActive: true } },
        }),
        ApiBadRequestResponse({ description: causes("Invalid", [PRICE_ABOVE_MRP, "maxOrderQty < minOrderQty", ...STATUS_ERRORS]), schema: errorSchema(400, "Bad Request", "Selling price cannot exceed MRP (56)", "PRICE_ABOVE_MRP") }),
        ApiNotFoundResponse({ description: "`variantNotAvailable`", schema: errorSchema(404, "Not Found", "Variant not available for listing") }),
        ApiConflictResponse({ description: "`alreadyListed`", schema: errorSchema(409, "Conflict", "Already listed on this store") }),
    );

export const ApiUpdateListing = () =>
    applyDecorators(
        ApiOperation({
            summary: "Update price / limits / status of one listing",
            description:
                "Store manager / admin only. `sellingPrice` must be <= admin MRP and <= the MRP of the batch being sold. Sending a price " +
                "clears an MRP_RESET alert. " + STATUS_RULES,
        }),
        LISTING_ID,
        ApiBody({
            type: UpdateListingDto,
            examples: {
                price: { summary: "Re-price", value: { sellingPrice: 49.5 } },
                deactivate: { summary: "Deactivate", value: { status: "INACTIVE" } },
                schedule: { summary: "Schedule with new price", value: { sellingPrice: 48, status: "SCHEDULED", publishAt: "2026-10-25T03:30:00.000Z" } },
                limits: { summary: "Limits", value: { maxOrderQty: 4, lowStockThreshold: 10, shelfLocation: "B-01-4" } },
            },
        }),
        ApiOkResponse({ description: "Updated listing", type: ListingDoc }),
        ApiBadRequestResponse({ description: causes("Invalid", [PRICE_ABOVE_MRP, "`maxLtMin`", ...STATUS_ERRORS]), schema: errorSchema(400, "Bad Request", "Selling price cannot exceed MRP (56)", "PRICE_ABOVE_MRP") }),
        LISTING_NOT_FOUND,
    );

export const ApiBulkPrice = () =>
    applyDecorators(
        ApiOperation({ summary: "Re-price many listings", description: "Store manager / admin only. All or nothing; each price <= its MRP cap." }),
        ApiBody({ type: BulkPriceDto, examples: { two: { summary: "Two listings", value: { items: [{ storeProductId: 88, sellingPrice: 50 }, { storeProductId: 91, sellingPrice: 97 }] } } } }),
        ApiOkResponse({ description: "Done", schema: { example: { success: true, updated: 2 } } }),
        ApiBadRequestResponse({ description: PRICE_ABOVE_MRP, schema: errorSchema(400, "Bad Request", "Selling price cannot exceed MRP (56)", "PRICE_ABOVE_MRP") }),
        ApiNotFoundResponse({ description: "`listingNotInStore`", schema: errorSchema(404, "Not Found", "Listing 91 not found in this store") }),
    );

export const ApiBulkStatus = () =>
    applyDecorators(
        ApiOperation({
            summary: "Set one status on many listings",
            description:
                "Store manager / admin only. Target `storeProductIds`, or every listing of `productId` (e.g. schedule a whole product). " +
                "All or nothing: if any listing may not get the status, nothing changes. " + STATUS_RULES,
        }),
        ApiBody({
            type: BulkListingStatusDto,
            examples: {
                ids: { summary: "Deactivate two listings", value: { storeProductIds: [88, 89], status: "INACTIVE" } },
                product: { summary: "Schedule a whole product", value: { productId: 345, status: "SCHEDULED", publishAt: "2026-10-25T03:30:00.000Z" } },
            },
        }),
        ApiOkResponse({ description: "Done", schema: { example: { success: true, updated: 3, status: "SCHEDULED", publishAt: "2026-10-25T03:30:00.000Z" } } }),
        ApiBadRequestResponse({
            description: causes("Invalid", ["Neither `storeProductIds` nor `productId` (code BULK_TARGET_REQUIRED)", ...STATUS_ERRORS]),
            schema: errorSchema(400, "Bad Request", "Send storeProductIds or productId", "BULK_TARGET_REQUIRED"),
        }),
        ApiNotFoundResponse({ description: "A listing is not in this store (`listingNotInStore`)", schema: errorSchema(404, "Not Found", "Listing 91 not found in this store") }),
    );

// =====================================================================
// Stock operations
// =====================================================================

export const ApiReceiveGoods = () =>
    applyDecorators(
        ApiOperation({
            summary: "Stock in against a supplier invoice (GRN)",
            description:
                "Requires `inventory.write`. Upload the invoice first (`POST /account/media`, purpose `INVOICE`, image or PDF) — mandatory. " +
                "One invoice → many products (`items`), one product → many batches (`batches`). Only listings that are not " +
                "PENDING_APPROVAL can receive stock. The same supplier + invoice number can't be posted twice. Per batch: accepted = " +
                "received − rejected is added (batch-tracked listings upsert the batch; too close to expiry → QUARANTINE). Each batch " +
                "logs a PURCHASE movement. Mistakes are fixed through `POST receipts/{id}/edit-request` (admin approval).",
        }),
        ApiBody({
            type: ReceiveGoodsDto,
            examples: {
                invoice: {
                    summary: "One invoice, two products, one with two batches",
                    value: {
                        supplierName: "Fresh Dairy Distributors",
                        supplierInvoiceNo: "INV-55120",
                        supplierInvoiceDate: "2026-10-22",
                        invoiceMediaIds: [9301],
                        items: [
                            {
                                storeProductId: 88,
                                batches: [
                                    { batchNumber: "B2410A", manufacturedAt: "2026-10-20", expiryDate: "2026-10-27", receivedQty: 48, rejectedQty: 2, rejectReason: "Leaking", costPrice: 41.2, mrp: 56 },
                                    { batchNumber: "B2410B", expiryDate: "2026-10-30", receivedQty: 24, costPrice: 41.2, mrp: 56 },
                                ],
                            },
                            { storeProductId: 140, batches: [{ receivedQty: 20, costPrice: 900, mrp: 1100 }] },
                        ],
                    },
                },
            },
        }),
        ApiCreatedResponse({ description: "GRN with lines", schema: { example: { ...GRN_EXAMPLE, invoiceMediaIds: [9301], status: "POSTED", editCount: 0 } } }),
        ApiBadRequestResponse({
            description: causes("Invalid", [
                "Invoice file missing / not INVOICE media of this store (code INVOICE_MEDIA_INVALID)",
                "`batchNumberRequired`", "`expiryMandatory` (perishable)", "`batchExpired`", "`mfgAfterExpiry`", "`rejectedGtReceived`",
            ]),
            schema: errorSchema(400, "Bad Request", "Attach the supplier invoice (upload with purpose INVOICE)", "INVOICE_MEDIA_INVALID"),
        }),
        ApiNotFoundResponse({ description: "`listingNotInStore`", schema: errorSchema(404, "Not Found", "Listing 88 not found in this store") }),
        ApiConflictResponse({
            description: causes("Conflict", [
                "Invoice already received (code DUPLICATE_INVOICE)",
                "Invoice file used by another GRN (code INVOICE_MEDIA_IN_USE)",
                "Listing waiting for admin approval (code LISTING_AWAITING_APPROVAL)",
                "Batch number reused with another MRP / expiry (code BATCH_CONFLICT)",
            ]),
            schema: errorSchema(409, "Conflict", "Invoice INV-55120 of this supplier was already received (GRN-MGZ1A2B3C4)", "DUPLICATE_INVOICE"),
        }),
    );

export const ApiGrnEditRequest = () =>
    applyDecorators(
        ApiOperation({
            summary: "Ask the admin to correct a goods receipt",
            description:
                "Store manager / admin. Nothing changes until an admin approves (GRN_EDIT request); the receipt shows EDIT_PENDING. " +
                "Editable: supplier / invoice details and files, per line received / rejected qty, reason, cost, mfg / expiry dates. On approval " +
                "quantity changes become ADJUSTMENT movements (refType GRN_EDIT); refused if the stock was already sold (GRN_EDIT_STOCK_USED) " +
                "or dates of a batch shared with other receipts change (GRN_EDIT_SHARED_BATCH). MRP / batch number can't change — stock out " +
                "and receive again instead.",
        }),
        IdParam("id", "Goods receipt ID", "77"),
        ApiBody({
            type: GrnEditRequestDto,
            examples: {
                qty: { summary: "Fix quantity", value: { note: "Invoice says 46, keyed 48", items: [{ itemId: 301, receivedQty: 46 }] } },
                header: { summary: "Fix invoice no + file", value: { note: "Wrong invoice number", header: { supplierInvoiceNo: "INV-55121", invoiceMediaIds: [9310] } } },
            },
        }),
        ApiOkResponse({ description: "Request created", schema: { example: { success: true, approvalId: "512", status: "PENDING" } } }),
        ApiBadRequestResponse({ description: causes("Invalid", ["Nothing to change (code NOTHING_TO_CHANGE)", "Item not in this GRN (code GRN_ITEM_NOT_FOUND)", "rejected > received"]), schema: errorSchema(400, "Bad Request", "Nothing to change", "NOTHING_TO_CHANGE") }),
        ApiConflictResponse({ description: "An edit is already pending (code APPROVAL_ALREADY_PENDING)", schema: errorSchema(409, "Conflict", "A request for this item is already waiting for a decision", "APPROVAL_ALREADY_PENDING") }),
    );

export const ApiProposeBarcodes = () =>
    applyDecorators(
        ApiOperation({
            summary: "Add barcodes to one variation (listing)",
            description:
                "Store manager / admin. Codes the catalogue already has for this variant are ignored; codes of another variant are refused " +
                "(BARCODE_TAKEN / BARCODE_PENDING). The rest go to the admin (BARCODE_ADD). The listing's status is not affected " +
                "(only a NEW listing created with an unknown barcode waits in PENDING_APPROVAL).",
        }),
        LISTING_ID,
        ApiBody({ type: ProposeBarcodesDto, examples: { one: { value: { barcodes: [{ code: "8901262010023", type: "EAN13" }], note: "New pack design" } } } }),
        ApiOkResponse({ description: "Request created", schema: { example: { success: true, approvalId: "520", codes: ["8901262010023"] } } }),
        ApiBadRequestResponse({ description: "All codes already on this variant (code BARCODES_ALREADY_KNOWN)", schema: errorSchema(400, "Bad Request", "These barcodes are already in the catalogue", "BARCODES_ALREADY_KNOWN") }),
        ApiConflictResponse({ description: causes("Conflict", ["Code belongs to another product (BARCODE_TAKEN)", "Code proposed for another product (BARCODE_PENDING)", "Request already pending (APPROVAL_ALREADY_PENDING)"]), schema: errorSchema(409, "Conflict", "Barcode 8901262010023 belongs to another product", "BARCODE_TAKEN") }),
        LISTING_NOT_FOUND,
    );

const FLASH_EXAMPLE = { state: "LIVE", price: money(39), startsAt: "2026-10-23T12:00:00.000Z", endsAt: "2026-10-23T14:00:00.000Z", qtyLimit: 100, soldQty: 37, remaining: 63, maxPerOrder: 2 };

export const ApiSetFlashSale = () =>
    applyDecorators(
        ApiOperation({
            summary: "Start / schedule a flash sale",
            description:
                "Store manager / admin. For ACTIVE or SCHEDULED listings. Price per item = `flashPrice` or `discountPercent` off the selling " +
                "price; must be below the selling price. Window up to 14 days. `qtyLimit` caps units sold at the flash price (then the regular " +
                "price applies); `maxPerOrder` caps units per order while live. Cart, checkout and storefront use the flash price automatically.",
        }),
        ApiBody({
            type: FlashSaleDto,
            examples: {
                happyHour: {
                    summary: "2-hour deal",
                    value: { startsAt: "2026-10-23T12:00:00.000Z", endsAt: "2026-10-23T14:00:00.000Z", maxPerOrder: 2, items: [{ storeProductId: 88, flashPrice: 39, qtyLimit: 100 }, { storeProductId: 91, discountPercent: 20 }] },
                },
            },
        }),
        ApiOkResponse({ description: "Saved", schema: { example: { success: true, updated: 2, startsAt: "2026-10-23T12:00:00.000Z", endsAt: "2026-10-23T14:00:00.000Z" } } }),
        ApiBadRequestResponse({
            description: causes("Invalid", ["Window invalid / in the past (FLASH_WINDOW_INVALID)", "Longer than 14 days (FLASH_TOO_LONG)", "Price not below selling price (FLASH_PRICE_NOT_LOWER)", "Listing not ACTIVE / SCHEDULED (FLASH_LISTING_NOT_LIVE)"]),
            schema: errorSchema(400, "Bad Request", "Flash price must be lower than the selling price (52)", "FLASH_PRICE_NOT_LOWER"),
        }),
        ApiNotFoundResponse({ description: "`listingNotInStore`", schema: errorSchema(404, "Not Found", "Listing 91 not found in this store") }),
    );

export const ApiEndFlashSale = () =>
    applyDecorators(
        ApiOperation({ summary: "End flash sales now", description: "Store manager / admin. Live sales end immediately; upcoming ones are removed." }),
        ApiBody({ type: EndFlashSaleDto, examples: { two: { value: { storeProductIds: [88, 91] } } } }),
        ApiOkResponse({ description: "Done", schema: { example: { success: true, cancelled: 0, ended: 2 } } }),
    );

export const ApiListFlashSales = () =>
    applyDecorators(
        ApiOperation({ summary: "Flash sales", description: "Requires `inventory.read`. `state` = live | upcoming | ended | all. Each listing carries `flashSale`." }),
        ApiOkResponse({ description: "Listings with a flash sale", schema: { example: { currency: { code: "BDT", symbol: "৳" }, items: [{ id: "88", title: "Amul Taaza Toned Milk", sellingPrice: money(52), effectivePrice: money(39), flashSale: FLASH_EXAMPLE }], total: 1, page: 1, limit: 20 } } }),
    );

export const ApiExpiryBuckets = () =>
    applyDecorators(
        ApiOperation({
            summary: "Stock by days to expiry",
            description:
                "Requires `inventory.read`. Buckets (store-local today): EXPIRED, DAYS_0_3, DAYS_4_7, DAYS_8_15, DAYS_16_30, DAYS_31_90, " +
                "DAYS_90_PLUS, NO_EXPIRY — batches, units, cost and retail value of ACTIVE / QUARANTINE / EXPIRED stock. Send `bucket` to " +
                "list its batches (soonest first) for clearance pricing, flash sales or stock-out.",
        }),
        ApiOkResponse({
            description: "Buckets",
            schema: {
                example: {
                    timezone: "Asia/Dhaka", today: "2026-10-23", currency: { code: "BDT", symbol: "৳" },
                    buckets: [
                        { bucket: "EXPIRED", batches: 1, units: 4, costValue: money(160), retailValue: money(208) },
                        { bucket: "DAYS_0_3", batches: 3, units: 42, costValue: money(1730), retailValue: money(2184) },
                    ],
                    bucket: "DAYS_0_3",
                    items: [{ ...BATCH_EXAMPLE, daysToExpiry: 2, listing: { id: "88", sku: "AMUL-TAAZA-500", title: "Amul Taaza Toned Milk", status: "ACTIVE", sellingPrice: money(52) } }],
                    total: 3, page: 1, limit: 20,
                },
            },
        }),
    );

export const ApiLowStock = () =>
    applyDecorators(
        ApiOperation({
            summary: "Low stock with reorder suggestions",
            description:
                "Requires `inventory.read`. ACTIVE / SCHEDULED listings at or below their threshold, most urgent first. `dailyVelocity` from " +
                "the last `days` (default 14) of sales; `suggestedReorderQty` covers `coverDays` (default 7) + threshold. Includes the last supplier.",
        }),
        ApiOkResponse({
            description: "Low stock",
            schema: {
                example: {
                    currency: { code: "BDT", symbol: "৳" }, window: { days: 14, coverDays: 7 },
                    items: [{ id: "88", title: "Amul Taaza Toned Milk", sellable: 4, lowStockThreshold: 10, soldInWindow: 168, dailyVelocity: 12, daysOfStockLeft: 0.3, suggestedReorderQty: 91, lastSupplier: { name: "Fresh Dairy Distributors", receivedAt: "2026-10-22T03:05:00.000Z", costPrice: money(41.2) } }],
                    total: 14, page: 1, limit: 20,
                },
            },
        }),
    );

export const ApiStockOut = () =>
    applyDecorators(
        ApiOperation({
            summary: "Stock out — remove units (damage, loss, expiry, vendor return)",
            description:
                "Requires `inventory.write`. Each line removes `quantity` units; batch-tracked lines take from `batchId` or, when omitted, " +
                "FEFO across sellable batches. Stock reserved by open orders cannot be removed (409 BELOW_RESERVED). All lines succeed or " +
                "none. Send `idempotencyKey` to make retries safe (`{ duplicate: true }` on replay).",
        }),
        ApiBody({
            type: StockOutDto,
            examples: {
                vendorReturn: { summary: "Return to supplier (FEFO)", value: { reason: "VENDOR_RETURN", note: "Leaking packs", idempotencyKey: "so-2026-10-20-7", items: [{ storeProductId: 88, quantity: 6 }] } },
                damage: { summary: "Damaged from a given batch", value: { reason: "DAMAGE", items: [{ storeProductId: 88, batchId: 412, quantity: 2 }] } },
            },
        }),
        ApiCreatedResponse({
            description: "Removed",
            schema: {
                example: {
                    success: true,
                    reason: "VENDOR_RETURN",
                    lines: [{ storeProductId: "88", removed: 6, balanceAfter: 34, batches: [{ batchId: "412", batchNumber: "B2410A", quantity: 6 }] }],
                },
            },
        }),
        ApiBadRequestResponse({ description: "`batchNegative` — batch has fewer units", schema: errorSchema(400, "Bad Request", "Batch quantity cannot go negative") }),
        ApiNotFoundResponse({ description: "`listingNotInStore` / `batchNotFound`", schema: errorSchema(404, "Not Found", "Batch not found") }),
        ApiConflictResponse({
            description: causes("Conflict", ["Would drop below reserved units (code BELOW_RESERVED)", "Not enough sellable batch stock (code BATCH_STOCK_UNAVAILABLE)"]),
            schema: errorSchema(409, "Conflict", "Cannot drop below reserved quantity (open orders)", "BELOW_RESERVED"),
        }),
    );

export const ApiAdjustStock = () =>
    applyDecorators(
        ApiOperation({
            summary: "Adjust stock of one listing / batch (signed delta)",
            description:
                "Requires `inventory.write`. Cycle-count corrections and write-offs. Only ADJUSTMENT may be positive. Batch-tracked listings " +
                "need `batchId`. Changes on non-ACTIVE batches are logged without touching the sellable balance.",
        }),
        ApiBody({
            type: AdjustStockDto,
            examples: {
                countUp: { summary: "Found 3 more on count", value: { storeProductId: 88, batchId: 412, delta: 3, type: "ADJUSTMENT", note: "Cycle count" } },
                lost: { summary: "Lost 1", value: { storeProductId: 140, delta: -1, type: "LOST", idempotencyKey: "adj-140-2026-10-20" } },
            },
        }),
        ApiCreatedResponse({ description: "New balances (or `{ duplicate: true }`)", schema: { example: { storeQty: 41, batchQty: 15 } } }),
        ApiBadRequestResponse({ description: causes("Invalid", ["`deltaZero`", "`typeMustBeNegative`", "`batchIdRequired`", "`batchNegative`"]), schema: errorSchema(400, "Bad Request", "DAMAGE must be negative") }),
        ApiNotFoundResponse({ description: "`notFound` / `batchNotFound`", schema: errorSchema(404, "Not Found", "Batch not found") }),
        ApiConflictResponse({ description: "`belowReserved`", schema: errorSchema(409, "Conflict", "Cannot drop below reserved quantity (open orders)") }),
    );

export const ApiBatchStatus = () =>
    applyDecorators(
        ApiOperation({
            summary: "Change batch status (release quarantine, recall, damage...)",
            description:
                "Store manager / admin only. Moving a batch in / out of ACTIVE adds / removes its units from the sellable balance. " +
                "`clearancePrice` sets a near-expiry discount (<= batch MRP). Expired batches cannot be made ACTIVE.",
        }),
        idParam("id", "Batch ID", "412"),
        ApiBody({
            type: BatchStatusDto,
            examples: {
                release: { summary: "Release quarantine", value: { status: "ACTIVE" } },
                recall: { summary: "Recall", value: { status: "RECALLED" } },
                clearance: { summary: "Clearance price", value: { status: "ACTIVE", clearancePrice: 30 } },
            },
        }),
        ApiOkResponse({ description: "Done", type: SuccessDoc }),
        ApiBadRequestResponse({ description: causes("Invalid", ["`clearanceGtMrp`", "`batchExpired`"]), schema: errorSchema(400, "Bad Request", "Batch B2410A is already expired") }),
        ApiNotFoundResponse({ description: "`notFound`", schema: errorSchema(404, "Not Found", "Not found") }),
    );

// =====================================================================
// Admin only
// =====================================================================

export const ApiAdminInventoryOverview = () =>
    applyDecorators(
        ApiOperation({
            summary: "Stock health of every store (store picker)",
            description:
                "Requires `inventory.read`. One row per store with listing counts, out-of-stock, low-stock, price alerts and retail stock value. " +
                "Pick a store, then use `/admin/stores/{storeId}/inventory/...`. `q` matches code, name or city.",
        }),
        ApiOkResponse({
            description: "Stores",
            schema: {
                example: {
                    currency: CURRENCY,
                    items: [
                        {
                            id: "7", code: "DS-DHK-GLS01", name: "Gulshan Hub Dark Store", city: "Dhaka", status: "ACTIVE", isOpen: true, acceptingOrders: true,
                            inventory: { listings: 132, active: 117, draft: 5, scheduled: 4, outOfStock: 6, lowStock: 14, priceAlerts: 2, retailValue: money(318200) },
                        },
                    ],
                    total: 9, page: 1, limit: 20,
                },
            },
        }),
    );

// ─── "Add from catalog": facets, media, change requests ──────────────────────

const CATEGORY_FACET = {
    id: "12", slug: "dairy", name: "Dairy", parentId: null, depth: 0, position: 1,
    iconUrl: "https://cdn.example.com/c/12/thumb.webp",
    productCount: 48, listedCount: 30, unlistedCount: 18, toAddCount: 25, childCount: 3, updatedAt: "2026-10-20T04:00:00.000Z",
    path: [],
};

export const ApiCatalogCategories = () =>
    applyDecorators(
        ApiOperation({
            summary: "Categories to pick products from (non-empty only)",
            description:
                "Requires `inventory.read`. Only ACTIVE categories that have PUBLISHED products in their subtree. Counts include sub-categories: " +
                "`productCount`, `listedCount` (at least one variation listed in this store), `unlistedCount` (no variation listed), `toAddCount` (at least one active variation not listed yet). `childCount` = non-empty children.\n\n" +
                "- `view=flat` (default, paged): `parentId=0` top level, `parentId=12` children of 12, omit for every level. `q` searches name (any language) / slug; each row has its `path`.\n" +
                "- `view=tree`: nested `children`, no paging (from the roots or from `parentId`); `q` keeps branches containing a match.\n" +
                "- `listed=to_add` shows only categories with something left to add (`unlisted` = products with nothing listed yet); `brandIds` counts only those brands.\n" +
                "- Sort: `position` (default), `name_asc`, `name_desc`, `products_desc`, `unlisted_desc`, `updated_desc`.\n\n" +
                "Then load products with `GET …/inventory/catalog?categoryIds=12,15&brandIds=4`. Counts are cached for 60 s.",
        }),
        ApiOkResponse({ description: "Categories", schema: { example: { items: [CATEGORY_FACET, { ...CATEGORY_FACET, id: "15", slug: "milk", name: "Milk", parentId: "12", depth: 1, productCount: 20, listedCount: 14, unlistedCount: 6, toAddCount: 9, childCount: 0, path: [{ id: "12", name: "Dairy" }] }], total: 2, page: 1, limit: 50 } } }),
        ApiBadRequestResponse({ description: "Invalid filter", schema: errorSchema(400, "Bad Request", ["sort must be one of the following values: position, name_asc, name_desc, products_desc, unlisted_desc, updated_desc"]) }),
    );

export const ApiCatalogBrands = () =>
    applyDecorators(
        ApiOperation({
            summary: "Brands to pick products from (non-empty only)",
            description:
                "Requires `inventory.read`. Only ACTIVE brands with PUBLISHED products (in `categoryIds` and their sub-categories, when given). " +
                "Same counts and `listed` filter as categories. `q` searches name (any language) / slug. Sort: `name_asc` (default), `name_desc`, " +
                "`products_desc`, `unlisted_desc`, `updated_desc`.",
        }),
        ApiOkResponse({
            description: "Brands",
            schema: { example: { items: [{ id: "4", slug: "amul", name: "Amul", logoUrl: "https://cdn.example.com/b/4/thumb.webp", productCount: 22, listedCount: 15, unlistedCount: 7, toAddCount: 10, updatedAt: "2026-10-18T04:00:00.000Z" }], total: 1, page: 1, limit: 50 } },
        }),
    );

export const ApiCatalogChangeRequest = () =>
    applyDecorators(
        ApiOperation({
            summary: "Ask the admin to fix a catalogue product (or one variation)",
            description:
                "Store manager. The catalogue is admin-owned, so wrong titles, photos, videos, audio, MRP, barcodes, … are reported here with a note. " +
                "Optionally attach suggested files (`POST /account/media`, purpose `PRODUCT`, your own uploads). Opens a `CATALOG_CHANGE` approval request; " +
                "the admin fixes the product and approves (optionally `applyMedia: true` attaches your images / videos to the gallery or variation) or rejects with a note. " +
                "One pending request per product (or variation) per store. Your requests show on `GET …/inventory/products/{productId}` → `changeRequests` and in `GET /store/approvals?box=outbox`.",
        }),
        PRODUCT_ID,
        ApiBody({
            type: CatalogChangeRequestDto,
            examples: {
                media: { summary: "Old pack photo, new photo attached", value: { fields: ["IMAGES"], note: "Pack design changed in October; new photo attached", mediaIds: [9401] } },
                variation: { summary: "One variation", value: { variantId: 88, fields: ["MRP", "BARCODE"], note: "500 ml pack now shows MRP 58 and EAN 8901262010047" } },
            },
        }),
        ApiOkResponse({ description: "Request opened", schema: { example: { success: true, approvalId: "512", status: "PENDING" } } }),
        ApiBadRequestResponse({
            description: "Variation not in product (VARIANT_NOT_IN_PRODUCT) / files not your PRODUCT uploads (CHANGE_MEDIA_INVALID)",
            schema: errorSchema(400, "Bad Request", "Suggested files must be your own uploads with purpose PRODUCT", "CHANGE_MEDIA_INVALID"),
        }),
        ApiConflictResponse({ description: "Already pending (APPROVAL_ALREADY_PENDING)", schema: errorSchema(409, "Conflict", "A request for this item is already waiting for a decision", "APPROVAL_ALREADY_PENDING") }),
        ApiNotFoundResponse({ description: "Product not published / deleted", schema: errorSchema(404, "Not Found", "Product is not available for listing") }),
    );
