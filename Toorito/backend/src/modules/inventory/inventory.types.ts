import { PageQueryDto } from "@common/dto/page-query.dto";
import {
    BarcodeType,
    StockMovementType,
    StoreListingStatus,
    StorePriceStatus,
} from "@prisma-client/enums";

import { Prisma } from "@prisma-client/client";
import { SNAPSHOT_VARIANT_INCLUDE, LISTING_INCLUDE } from "./inventory.util";

/** Plain input / output types of the inventory services (no decorators). */

export type Tx = Prisma.TransactionClient;

export interface PickedBatch {
    batchId: bigint;
    batchNumber: string;
    mrp: number;
    clearancePrice: number | null;
    manufacturedAt: Date | null;
    expiryDate: Date | null;
    take: number;
}

/**
 * Store-side copy of the catalogue data (StoreProduct.snapshot).
 * Written when a variant is listed and on explicit re-sync; the global
 * Product / ProductVariant rows are never modified by store actions.
 */
export interface StoreProductSnapshot {
    version: 1;
    productId: string;
    variantId: string;
    slug: string;
    /** lang → title */
    title: Record<string, string>;
    brand: { id: string; name: unknown } | null;
    category: { id: string; name: unknown } | null;
    thumbnailId: string | null;
    sku: string;
    /** [{ group: "size", groupName: {...}, value: "1l", label: {...} }] */
    options: {
        group: string;
        groupName: unknown;
        value: string;
        label: unknown;
    }[];
    unit: string | null;
    unitValue: number | null;
    weightGrams: number | null;
    mrp: number;
    gstRate: number;
    hsnCode: string | null;
    dietType: string | null;
    isPerishable: boolean;
    shelfLifeDays: number | null;
    barcodes: string[];
    capturedAt: string;
}

export type SnapshotVariant = Prisma.ProductVariantGetPayload<{
    include: typeof SNAPSHOT_VARIANT_INCLUDE;
}>;

export type ListingRow = Prisma.StoreProductGetPayload<{
    include: typeof LISTING_INCLUDE;
}>;

/** Store listing joined with the product fields needed while receiving goods. */
export type ListingForReceipt = Prisma.StoreProductGetPayload<{
    include: {
        product: { select: { isPerishable: true; shelfLifeDays: true } };
    };
}>;

/** Shared context for every line of one goods receipt. */
export interface ReceiptContext {
    grnId: bigint;
    storeId: bigint;
    actorId: bigint;
    supplierName?: string;
    tz: string;
    today: Date;
}

/** Flash-sale columns of a listing. */
export interface FlashFields {
    sellingPrice: unknown;
    flashPrice: unknown;
    flashStartsAt: Date | null;
    flashEndsAt: Date | null;
    flashQtyLimit: number | null;
    flashSoldQty: number;
    flashMaxPerOrder: number | null;
}

// ---------------------------------------------------------------------
// Service inputs (the HTTP DTOs in src/api implement these)
// ---------------------------------------------------------------------

/** Manual corrections (`POST adjust`). Only ADJUSTMENT may add stock. */
export const ADJUST_TYPES = [
    StockMovementType.ADJUSTMENT,
    StockMovementType.DAMAGE,
    StockMovementType.EXPIRED,
    StockMovementType.LOST,
    StockMovementType.VENDOR_RETURN,
] as const;

export type AdjustType = (typeof ADJUST_TYPES)[number];

/** Reasons accepted by `POST stock-out` (always removes stock). */
export const STOCK_OUT_REASONS = [
    StockMovementType.DAMAGE,
    StockMovementType.EXPIRED,
    StockMovementType.LOST,
    StockMovementType.VENDOR_RETURN,
    StockMovementType.ADJUSTMENT,
] as const;

export type StockOutReason = (typeof STOCK_OUT_REASONS)[number];

/** Statuses a client may set. PENDING_APPROVAL is system-only (barcode waiting for admin). */
export const CLIENT_LISTING_STATUSES = [
    StoreListingStatus.DRAFT,
    StoreListingStatus.SCHEDULED,
    StoreListingStatus.ACTIVE,
    StoreListingStatus.INACTIVE,
] as const;

export type ClientListingStatus = (typeof CLIENT_LISTING_STATUSES)[number];

/** A barcode the store proposes for a catalogue variant. */
export interface BarcodeInput {
    code: string;
    type?: BarcodeType;
}

export const STOCK_FILTERS = ["in", "low", "out", "reserved"] as const;

export type StockFilter = (typeof STOCK_FILTERS)[number];

/** Listing settings shared by single-variant and product-level listing. */
export interface ListingSettingsInput {
    lowStockThreshold?: number;
    minOrderQty?: number;
    maxOrderQty?: number;
    trackBatches?: boolean;
    minSellableDays?: number;
    shelfLocation?: string;
}

/** List ONE catalogue variant on the store (legacy single-variant endpoint). */
export interface ListOnStoreInput extends ListingSettingsInput {
    barcodes?: BarcodeInput[];
    variantId: number;
    sellingPrice: number;
    status?: ClientListingStatus;
    publishAt?: string;
}

/** One variant line of a product-level listing. */
export interface VariantListingInput {
    barcodes?: BarcodeInput[];
    variantId: number;
    sellingPrice?: number;
    status?: ClientListingStatus;
}

/**
 * List (or update) a whole catalogue product on the store.
 * Simple product: one entry in `variants`. Variable product: any subset of its variants,
 * each one individually enabled / disabled.
 */
export interface ListProductOnStoreInput extends ListingSettingsInput {
    productId: number;
    variants: VariantListingInput[];
    status?: ClientListingStatus;
    publishAt?: string;
}

/** Change the status of one listing / variation. */
export interface ListingStatusInput {
    status: ClientListingStatus;
    publishAt?: string;
}

/** Change the status of many listings: pick them by id, or every listing of one product. */
export interface BulkListingStatusInput extends ListingStatusInput {
    storeProductIds?: number[];
    productId?: number;
}

export interface UpdateListingInput {
    sellingPrice?: number;
    lowStockThreshold?: number;
    minOrderQty?: number;
    maxOrderQty?: number;
    minSellableDays?: number;
    shelfLocation?: string;
    status?: ClientListingStatus;
    publishAt?: string;
}

/** Bulk price change for many listings at once. */
export interface BulkPriceItemInput {
    storeProductId: number;
    sellingPrice: number;
}

export interface BulkPriceInput {
    items: BulkPriceItemInput[];
}

/** One batch of a product on the invoice. */
export interface ReceiptBatchInput {
    batchNumber?: string;
    manufacturedAt?: string;
    expiryDate?: string;
    shelfLifeDays?: number;
    receivedQty: number;
    rejectedQty?: number;
    rejectReason?: string;
    costPrice?: number;
    mrp: number;
}

/** One product (store listing) on the invoice, with one or more batches. */
export interface ReceiptProductInput {
    storeProductId: number;
    batches: ReceiptBatchInput[];
}

/** Stock in against a supplier invoice (invoice file mandatory). */
export interface ReceiveGoodsInput {
    supplierName: string;
    supplierPhone?: string;
    supplierInvoiceNo: string;
    supplierInvoiceDate?: string;
    invoiceMediaIds: number[];
    note?: string;
    items: ReceiptProductInput[];
}

/** Flattened line used by the service (one batch of one product). */
export type ReceiptItemDto = ReceiptBatchInput & { storeProductId: number };

export interface GrnHeaderEditInput {
    supplierName?: string;
    supplierPhone?: string;
    supplierInvoiceNo?: string;
    supplierInvoiceDate?: string;
    invoiceMediaIds?: number[];
}

export interface GrnItemEditInput {
    itemId: number;
    receivedQty?: number;
    rejectedQty?: number;
    rejectReason?: string;
    costPrice?: number;
    manufacturedAt?: string;
    expiryDate?: string;
}

/** Correction of a posted goods receipt: goes to the admin with the manager's note. */
export interface GrnEditRequestInput {
    note: string;
    header?: GrnHeaderEditInput;
    items?: GrnItemEditInput[];
}

/** Propose barcodes for an already-listed variant (doesn't affect its status). */
export interface ProposeBarcodesInput {
    barcodes: BarcodeInput[];
    note?: string;
}

export interface FlashItemInput {
    storeProductId: number;
    flashPrice?: number;
    discountPercent?: number;
    qtyLimit?: number;
}

/** Start / schedule a flash sale on one or more listings (replaces any current one on them). */
export interface FlashSaleInput {
    startsAt: string;
    endsAt: string;
    maxPerOrder?: number;
    items: FlashItemInput[];
}

export interface FlashListInput extends PageQueryDto {
    state?: "live" | "upcoming" | "ended" | "all";
}

export const EXPIRY_BUCKETS = [
    "EXPIRED",
    "DAYS_0_3",
    "DAYS_4_7",
    "DAYS_8_15",
    "DAYS_16_30",
    "DAYS_31_90",
    "DAYS_90_PLUS",
    "NO_EXPIRY",
] as const;

export type ExpiryBucket = (typeof EXPIRY_BUCKETS)[number];

export interface ExpiryInput extends PageQueryDto {
    bucket?: ExpiryBucket;
}

export interface LowStockInput extends PageQueryDto {
    days?: number;
    coverDays?: number;
}

export interface AdjustStockInput {
    storeProductId: number;
    batchId?: number;
    delta: number;
    type: AdjustType;
    note?: string;
    idempotencyKey?: string;
}

export interface StockOutItemInput {
    storeProductId: number;
    batchId?: number;
    quantity: number;
}

/** Remove stock for one reason (damage, loss, vendor return...). All lines succeed or none. */
export interface StockOutInput {
    reason: StockOutReason;
    note?: string;
    idempotencyKey?: string;
    items: StockOutItemInput[];
}

export const CATALOG_CATEGORY_SORTS = [
    "position",
    "name_asc",
    "name_desc",
    "products_desc",
    "unlisted_desc",
    "updated_desc",
] as const;

export const CATALOG_BRAND_SORTS = [
    "name_asc",
    "name_desc",
    "products_desc",
    "unlisted_desc",
    "updated_desc",
] as const;

/** "Add from catalog" — category facet. Only categories with PUBLISHED products (in their subtree) are returned. */
export interface CatalogCategoryInput extends PageQueryDto {
    q?: string;
    parentId?: number;
    view?: "flat" | "tree";
    listed?: "all" | "listed" | "unlisted" | "to_add";
    brandIds?: number[];
    sort?: (typeof CATALOG_CATEGORY_SORTS)[number];
}

/** "Add from catalog" — brand facet. Only brands with PUBLISHED products are returned. */
export interface CatalogBrandInput extends PageQueryDto {
    q?: string;
    categoryIds?: number[];
    listed?: "all" | "listed" | "unlisted" | "to_add";
    sort?: (typeof CATALOG_BRAND_SORTS)[number];
}

export const CATALOG_CHANGE_FIELDS = [
    "TITLE",
    "DESCRIPTION",
    "IMAGES",
    "VIDEO",
    "AUDIO",
    "VARIATION_MEDIA",
    "MRP",
    "BARCODE",
    "BRAND",
    "CATEGORY",
    "UNIT_OR_SIZE",
    "NUTRITION_OR_INGREDIENTS",
    "OTHER",
] as const;

/** Store manager → admin: something in the catalogue product (or one variation) needs fixing. */
export interface CatalogChangeRequestInput {
    variantId?: number;
    fields: (typeof CATALOG_CHANGE_FIELDS)[number][];
    note: string;
    mediaIds?: number[];
}

export interface CatalogInput extends PageQueryDto {
    q?: string;
    categoryId?: number;
    categoryIds?: number[];
    brandId?: number;
    brandIds?: number[];
    /** Category groups (their categories, sub-categories included); AND-ed with categoryIds. */
    groupIds?: number[];
    listed?: "all" | "listed" | "unlisted" | "to_add";
    status?: StoreListingStatus;
    stock?: "in" | "out";
    sort?: "newest" | "oldest" | "name" | "updated";
}

/** `GET listings` filters. */
export interface StockListInput extends PageQueryDto {
    /** Exactly this category (no sub-categories), as before. */
    categoryId?: number;
    /** Any of these categories, sub-categories included. */
    categoryIds?: number[];
    /** Any category of these groups, sub-categories included; AND-ed with categoryIds. */
    groupIds?: number[];
    brandIds?: number[];
    productId?: number;
    stock?: StockFilter;
    priceStatus?: StorePriceStatus;
    status?: StoreListingStatus;
    isActive?: boolean;
    q?: string;
}

/** `GET movements` — store-wide stock ledger. */
export interface LedgerInput extends PageQueryDto {
    storeProductId?: number;
    types?: StockMovementType[];
    from?: string;
    to?: string;
}

/** `GET listings/:id/movements` pagination. */
export interface MovementInput extends PageQueryDto {}

/** `GET receipts` — goods receipts (GRN). */
export interface ReceiptListInput extends PageQueryDto {
    q?: string;
    from?: string;
    to?: string;
}
