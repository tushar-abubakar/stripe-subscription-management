import {
    ADJUST_TYPES,
    AdjustType,
    STOCK_OUT_REASONS,
    StockOutReason,
    CLIENT_LISTING_STATUSES,
    ClientListingStatus,
    STOCK_FILTERS,
    StockFilter,
    EXPIRY_BUCKETS,
    ExpiryBucket,
    CATALOG_CATEGORY_SORTS,
    CATALOG_BRAND_SORTS,
    CATALOG_CHANGE_FIELDS,
    BarcodeInput,
    ListingSettingsInput,
    ListOnStoreInput,
    VariantListingInput,
    ListProductOnStoreInput,
    ListingStatusInput,
    BulkListingStatusInput,
    UpdateListingInput,
    BulkPriceItemInput,
    BulkPriceInput,
    ReceiptBatchInput,
    ReceiptProductInput,
    ReceiveGoodsInput,
    GrnHeaderEditInput,
    GrnItemEditInput,
    GrnEditRequestInput,
    ProposeBarcodesInput,
    FlashItemInput,
    FlashSaleInput,
    FlashListInput,
    ExpiryInput,
    LowStockInput,
    AdjustStockInput,
    StockOutItemInput,
    StockOutInput,
    CatalogCategoryInput,
    CatalogBrandInput,
    CatalogChangeRequestInput,
    CatalogInput,
    StockListInput,
    LedgerInput,
    MovementInput,
    ReceiptListInput,
} from "@modules/inventory/inventory.types";
import { PageQueryDto } from "@common/dto/page-query.dto";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
    BarcodeType,
    BatchStatus,
    StockMovementType,
    StoreListingStatus,
    StorePriceStatus,
} from "@prisma-client/enums";
import { Transform, Type } from "class-transformer";
import {
    ArrayMaxSize,
    ArrayMinSize,
    ArrayUnique,
    IsArray,
    IsBoolean,
    IsDateString,
    IsEnum,
    ValidateIf,
    IsIn,
    IsInt,
    IsNumber,
    IsOptional,
    IsString,
    Matches,
    Max,
    MaxLength,
    Min,
    MinLength,
    ValidateNested,
} from "class-validator";

/** Decimal places allowed for money / quantity fields. */
const decimal = (places: number) => ({
    maxDecimalPlaces: places,
});

/** Query-string booleans: "true" / "1" → true, "false" / "0" → false. */
const QueryBool = () =>
    Transform(({ value }) =>
        value === "true" || value === "1" || value === true
            ? true
            : value === "false" || value === "0" || value === false
              ? false
              : value,
    );

/** A barcode the store proposes for a catalogue variant. */
export class BarcodeDto implements BarcodeInput {
    @ApiProperty({ example: "8901262010016", minLength: 4, maxLength: 64, description: "Digits / letters / - only" })
    @IsString()
    @Matches(/^[A-Za-z0-9-]{4,64}$/)
    code: string;

    @ApiPropertyOptional({ enum: BarcodeType, default: BarcodeType.EAN13 })
    @IsOptional()
    @IsEnum(BarcodeType)
    type?: BarcodeType;
}

// =====================================================================
// Listing (store manager picks admin catalogue products)
// =====================================================================

/** Listing settings shared by single-variant and product-level listing. */
export class ListingSettingsDto implements ListingSettingsInput {
    @ApiPropertyOptional({ example: 5, minimum: 0, description: "Sellable qty at or below this is 'low stock'. Default from config." })
    @IsOptional()
    @IsInt()
    @Min(0)
    lowStockThreshold?: number;

    @ApiPropertyOptional({ example: 1, minimum: 1, default: 1 })
    @IsOptional()
    @IsInt()
    @Min(1)
    minOrderQty?: number;

    @ApiPropertyOptional({ example: 6, minimum: 1, description: "Per-order cap; must be >= minOrderQty" })
    @IsOptional()
    @IsInt()
    @Min(1)
    maxOrderQty?: number;

    @ApiPropertyOptional({ example: true, default: true, description: "false = single (non-batch) inventory, no expiry tracking" })
    @IsOptional()
    @IsBoolean()
    trackBatches?: boolean;

    @ApiPropertyOptional({ example: 2, minimum: 0, default: 0, description: "Batches expiring sooner than this many days are not sold" })
    @IsOptional()
    @IsInt()
    @Min(0)
    minSellableDays?: number;

    @ApiPropertyOptional({ example: "A-03-2", maxLength: 50 })
    @IsOptional()
    @IsString()
    @MaxLength(50)
    shelfLocation?: string;
}

/** List ONE catalogue variant on the store (legacy single-variant endpoint). */
export class ListOnStoreDto extends ListingSettingsDto implements ListOnStoreInput {
    @ApiPropertyOptional({ type: () => [BarcodeDto], maxItems: 5, description: "See VariantListingDto.barcodes" })
    @IsOptional()
    @IsArray()
    @ArrayMaxSize(5)
    @ValidateNested({ each: true })
    @Type(() => BarcodeDto)
    barcodes?: BarcodeDto[];

    @ApiProperty({ example: 1201, description: "Catalogue variant id (PUBLISHED product, active variant)" })
    @Type(() => Number)
    @IsInt()
    variantId: number;

    @ApiProperty({ example: 52, description: "Store selling price (tax-inclusive). Must be <= the admin MRP." })
    @IsNumber(decimal(2))
    @Min(0.01)
    sellingPrice: number;

    @ApiPropertyOptional({ enum: CLIENT_LISTING_STATUSES, default: StoreListingStatus.ACTIVE, description: "`DRAFT` (prepared, hidden), `SCHEDULED` (goes live at `publishAt`), `ACTIVE` (live), `INACTIVE` (switched off)" })
    @IsOptional()
    @IsIn(CLIENT_LISTING_STATUSES)
    status?: ClientListingStatus;

    @ApiPropertyOptional({ example: "2026-10-25T03:30:00.000Z", format: "date-time", description: "Required with status SCHEDULED" })
    @IsOptional()
    @IsDateString()
    publishAt?: string;
}

/** One variant line of a product-level listing. */
export class VariantListingDto implements VariantListingInput {
    @ApiPropertyOptional({
        type: () => [BarcodeDto],
        maxItems: 5,
        description:
            "Barcodes on the pack. Codes the catalogue already has for this variant are ignored; new ones go to the admin " +
            "(BARCODE_ADD) and a NEW listing waits in PENDING_APPROVAL until approved.",
    })
    @IsOptional()
    @IsArray()
    @ArrayMaxSize(5)
    @ValidateNested({ each: true })
    @Type(() => BarcodeDto)
    barcodes?: BarcodeDto[];

    @ApiProperty({ example: 1201, description: "Variant id; must belong to the product" })
    @Type(() => Number)
    @IsInt()
    variantId: number;

    @ApiPropertyOptional({
        example: 52,
        description: "Store selling price, <= variant MRP. Required when the variant is listed for the first time.",
    })
    @IsOptional()
    @IsNumber(decimal(2))
    @Min(0.01)
    sellingPrice?: number;

    @ApiPropertyOptional({
        enum: CLIENT_LISTING_STATUSES,
        example: StoreListingStatus.ACTIVE,
        description: "Status of this variation. Default: the product-level `status`. " + "`DRAFT` (prepared, hidden), `SCHEDULED` (goes live at `publishAt`), `ACTIVE` (live), `INACTIVE` (switched off)",
    })
    @IsOptional()
    @IsIn(CLIENT_LISTING_STATUSES)
    status?: ClientListingStatus;
}

/**
 * List (or update) a whole catalogue product on the store.
 * Simple product: one entry in `variants`. Variable product: any subset of its variants,
 * each one individually enabled / disabled.
 */
export class ListProductOnStoreDto extends ListingSettingsDto implements ListProductOnStoreInput {
    @ApiProperty({ example: 345, description: "Catalogue product id (must be PUBLISHED)" })
    @Type(() => Number)
    @IsInt()
    productId: number;

    @ApiProperty({ type: () => [VariantListingDto], minItems: 1, maxItems: 100 })
    @IsArray()
    @ArrayMinSize(1)
    @ArrayMaxSize(100)
    @ValidateNested({ each: true })
    @Type(() => VariantListingDto)
    variants: VariantListingDto[];

    @ApiPropertyOptional({
        enum: CLIENT_LISTING_STATUSES,
        default: StoreListingStatus.ACTIVE,
        description: "Default status for the variants sent (each line may override). " + "`DRAFT` (prepared, hidden), `SCHEDULED` (goes live at `publishAt`), `ACTIVE` (live), `INACTIVE` (switched off)",
    })
    @IsOptional()
    @IsIn(CLIENT_LISTING_STATUSES)
    status?: ClientListingStatus;

    @ApiPropertyOptional({
        example: "2026-10-25T03:30:00.000Z",
        format: "date-time",
        description: "Required when any line ends up SCHEDULED: when those variants go live (ISO 8601, at least 1 minute ahead)",
    })
    @IsOptional()
    @IsDateString()
    publishAt?: string;
}

/** Change the status of one listing / variation. */
export class ListingStatusDto implements ListingStatusInput {
    @ApiProperty({ enum: CLIENT_LISTING_STATUSES, example: StoreListingStatus.INACTIVE, description: "`DRAFT` (prepared, hidden), `SCHEDULED` (goes live at `publishAt`), `ACTIVE` (live), `INACTIVE` (switched off)" })
    @IsIn(CLIENT_LISTING_STATUSES)
    status: ClientListingStatus;

    @ApiPropertyOptional({
        example: "2026-10-25T03:30:00.000Z",
        format: "date-time",
        description: "Required for SCHEDULED (at least 1 minute ahead); ignored otherwise",
    })
    @ValidateIf((dto: ListingStatusDto) => dto.status === StoreListingStatus.SCHEDULED || dto.publishAt !== undefined)
    @IsDateString()
    publishAt?: string;
}

/** Change the status of many listings: pick them by id, or every listing of one product. */
export class BulkListingStatusDto extends ListingStatusDto implements BulkListingStatusInput {
    @ApiPropertyOptional({ type: [Number], example: [88, 89], maxItems: 200, description: "Listing ids (or send `productId`)" })
    @IsOptional()
    @IsArray()
    @ArrayMinSize(1)
    @ArrayMaxSize(200)
    @Type(() => Number)
    @IsInt({ each: true })
    storeProductIds?: number[];

    @ApiPropertyOptional({ example: 345, description: "Every listing of this product in the store (or send `storeProductIds`)" })
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    productId?: number;
}

export class UpdateListingDto implements UpdateListingInput {
    @ApiPropertyOptional({ example: 49.5, description: "New selling price, <= admin MRP (and <= MRP printed on the selling batch)" })
    @IsOptional()
    @IsNumber(decimal(2))
    @Min(0.01)
    sellingPrice?: number;

    @ApiPropertyOptional({ example: 8, minimum: 0 })
    @IsOptional()
    @IsInt()
    @Min(0)
    lowStockThreshold?: number;

    @ApiPropertyOptional({ example: 1, minimum: 1 })
    @IsOptional()
    @IsInt()
    @Min(1)
    minOrderQty?: number;

    @ApiPropertyOptional({ example: 10, minimum: 1 })
    @IsOptional()
    @IsInt()
    @Min(1)
    maxOrderQty?: number;

    @ApiPropertyOptional({ example: 3, minimum: 0 })
    @IsOptional()
    @IsInt()
    @Min(0)
    minSellableDays?: number;

    @ApiPropertyOptional({ example: "B-01-4", maxLength: 50 })
    @IsOptional()
    @IsString()
    @MaxLength(50)
    shelfLocation?: string;

    @ApiPropertyOptional({ enum: CLIENT_LISTING_STATUSES, example: StoreListingStatus.ACTIVE, description: "`DRAFT` (prepared, hidden), `SCHEDULED` (goes live at `publishAt`), `ACTIVE` (live), `INACTIVE` (switched off)" })
    @IsOptional()
    @IsIn(CLIENT_LISTING_STATUSES)
    status?: ClientListingStatus;

    @ApiPropertyOptional({ example: "2026-10-25T03:30:00.000Z", format: "date-time", description: "Required with status SCHEDULED" })
    @IsOptional()
    @IsDateString()
    publishAt?: string;
}

/** Bulk price change for many listings at once. */
export class BulkPriceItemDto implements BulkPriceItemInput {
    @ApiProperty({ example: 88 })
    @Type(() => Number)
    @IsInt()
    storeProductId: number;

    @ApiProperty({ example: 45 })
    @IsNumber(decimal(2))
    @Min(0.01)
    sellingPrice: number;
}

export class BulkPriceDto implements BulkPriceInput {
    @ApiProperty({ type: () => [BulkPriceItemDto], minItems: 1, maxItems: 200 })
    @IsArray()
    @ArrayMinSize(1)
    @ArrayMaxSize(200)
    @ValidateNested({ each: true })
    @Type(() => BulkPriceItemDto)
    items: BulkPriceItemDto[];
}

// =====================================================================
// Stock in (GRN), stock out, adjustments, batches
// =====================================================================

/** One batch of a product on the invoice. */
export class ReceiptBatchDto implements ReceiptBatchInput {
    @ApiPropertyOptional({ example: "B2410A", maxLength: 60, description: "Required when the listing tracks batches" })
    @IsOptional()
    @IsString()
    @MaxLength(60)
    batchNumber?: string;

    @ApiPropertyOptional({ example: "2026-10-18", format: "date" })
    @IsOptional()
    @IsDateString()
    manufacturedAt?: string;

    @ApiPropertyOptional({ example: "2026-10-28", format: "date", description: "Mandatory for perishables unless mfg date + shelf life is known" })
    @IsOptional()
    @IsDateString()
    expiryDate?: string;

    @ApiPropertyOptional({ example: 10, minimum: 1 })
    @IsOptional()
    @IsInt()
    @Min(1)
    shelfLifeDays?: number;

    @ApiProperty({ example: 48, minimum: 1, description: "Units delivered for this batch (incl. rejected)" })
    @IsInt()
    @Min(1)
    receivedQty: number;

    @ApiPropertyOptional({ example: 2, minimum: 0, description: "Units refused at the door (not stocked)" })
    @IsOptional()
    @IsInt()
    @Min(0)
    rejectedQty?: number;

    @ApiPropertyOptional({ example: "Crushed packs", maxLength: 255 })
    @IsOptional()
    @IsString()
    @MaxLength(255)
    rejectReason?: string;

    @ApiPropertyOptional({ example: 41.2, description: "Purchase cost per unit" })
    @IsOptional()
    @IsNumber(decimal(2))
    @Min(0)
    costPrice?: number;

    @ApiProperty({ example: 56, description: "MRP printed on this batch" })
    @IsNumber(decimal(2))
    @Min(0.01)
    mrp: number;
}

/** One product (store listing) on the invoice, with one or more batches. */
export class ReceiptProductDto implements ReceiptProductInput {
    @ApiProperty({ example: 88, description: "Store listing id (not PENDING_APPROVAL)" })
    @Type(() => Number)
    @IsInt()
    storeProductId: number;

    @ApiProperty({ type: () => [ReceiptBatchDto], minItems: 1, maxItems: 20 })
    @IsArray()
    @ArrayMinSize(1)
    @ArrayMaxSize(20)
    @ValidateNested({ each: true })
    @Type(() => ReceiptBatchDto)
    batches: ReceiptBatchDto[];
}

/** Stock in against a supplier invoice (invoice file mandatory). */
export class ReceiveGoodsDto implements ReceiveGoodsInput {
    @ApiProperty({ example: "Fresh Dairy Distributors", maxLength: 150 })
    @IsString()
    @MaxLength(150)
    supplierName: string;

    @ApiPropertyOptional({ example: "+8801711000000" })
    @IsOptional()
    @IsString()
    @MaxLength(20)
    supplierPhone?: string;

    @ApiProperty({ example: "INV-55120", maxLength: 60, description: "Same supplier + invoice no can't be received twice" })
    @IsString()
    @MinLength(1)
    @MaxLength(60)
    supplierInvoiceNo: string;

    @ApiPropertyOptional({ example: "2026-10-19", format: "date" })
    @IsOptional()
    @IsDateString()
    supplierInvoiceDate?: string;

    @ApiProperty({
        type: [Number],
        example: [9301],
        minItems: 1,
        maxItems: 10,
        description: "Invoice file(s): upload first with POST /account/media (purpose INVOICE, image or PDF). Mandatory.",
    })
    @IsArray()
    @ArrayMinSize(1)
    @ArrayMaxSize(10)
    @ArrayUnique()
    @Type(() => Number)
    @IsInt({ each: true })
    invoiceMediaIds: number[];

    @ApiPropertyOptional({ example: "Morning delivery, 2 crates damaged", maxLength: 255 })
    @IsOptional()
    @IsString()
    @MaxLength(255)
    note?: string;

    @ApiProperty({ type: () => [ReceiptProductDto], minItems: 1, maxItems: 200 })
    @IsArray()
    @ArrayMinSize(1)
    @ArrayMaxSize(200)
    @ValidateNested({ each: true })
    @Type(() => ReceiptProductDto)
    items: ReceiptProductDto[];
}

export class GrnHeaderEditDto implements GrnHeaderEditInput {
    @ApiPropertyOptional({ example: "Fresh Dairy Ltd." })
    @IsOptional()
    @IsString()
    @MaxLength(150)
    supplierName?: string;

    @ApiPropertyOptional({ example: "+8801711000000" })
    @IsOptional()
    @IsString()
    @MaxLength(20)
    supplierPhone?: string;

    @ApiPropertyOptional({ example: "INV-55121" })
    @IsOptional()
    @IsString()
    @MaxLength(60)
    supplierInvoiceNo?: string;

    @ApiPropertyOptional({ example: "2026-10-19", format: "date" })
    @IsOptional()
    @IsDateString()
    supplierInvoiceDate?: string;

    @ApiPropertyOptional({ type: [Number], example: [9301, 9310], description: "Replaces the invoice files (purpose INVOICE)" })
    @IsOptional()
    @IsArray()
    @ArrayMinSize(1)
    @ArrayMaxSize(10)
    @ArrayUnique()
    @Type(() => Number)
    @IsInt({ each: true })
    invoiceMediaIds?: number[];
}

export class GrnItemEditDto implements GrnItemEditInput {
    @ApiProperty({ example: 301, description: "GoodsReceiptItem id" })
    @Type(() => Number)
    @IsInt()
    itemId: number;

    @ApiPropertyOptional({ example: 46 })
    @IsOptional()
    @IsInt()
    @Min(0)
    receivedQty?: number;

    @ApiPropertyOptional({ example: 4 })
    @IsOptional()
    @IsInt()
    @Min(0)
    rejectedQty?: number;

    @ApiPropertyOptional({ example: "Leaking" })
    @IsOptional()
    @IsString()
    @MaxLength(255)
    rejectReason?: string;

    @ApiPropertyOptional({ example: 40.5 })
    @IsOptional()
    @IsNumber(decimal(2))
    @Min(0)
    costPrice?: number;

    @ApiPropertyOptional({ example: "2026-10-18", format: "date" })
    @IsOptional()
    @IsDateString()
    manufacturedAt?: string;

    @ApiPropertyOptional({ example: "2026-10-29", format: "date" })
    @IsOptional()
    @IsDateString()
    expiryDate?: string;
}

/** Correction of a posted goods receipt: goes to the admin with the manager's note. */
export class GrnEditRequestDto implements GrnEditRequestInput {
    @ApiProperty({ example: "Supplier invoice says 46 units, we keyed 48", maxLength: 1000 })
    @IsString()
    @MinLength(3)
    @MaxLength(1000)
    note: string;

    @ApiPropertyOptional({ type: () => GrnHeaderEditDto })
    @IsOptional()
    @ValidateNested()
    @Type(() => GrnHeaderEditDto)
    header?: GrnHeaderEditDto;

    @ApiPropertyOptional({ type: () => [GrnItemEditDto], maxItems: 200 })
    @IsOptional()
    @IsArray()
    @ArrayMaxSize(200)
    @ValidateNested({ each: true })
    @Type(() => GrnItemEditDto)
    items?: GrnItemEditDto[];
}

/** Propose barcodes for an already-listed variant (doesn't affect its status). */
export class ProposeBarcodesDto implements ProposeBarcodesInput {
    @ApiProperty({ type: () => [BarcodeDto], minItems: 1, maxItems: 5 })
    @IsArray()
    @ArrayMinSize(1)
    @ArrayMaxSize(5)
    @ValidateNested({ each: true })
    @Type(() => BarcodeDto)
    barcodes: BarcodeDto[];

    @ApiPropertyOptional({ example: "New pack design from Nov", maxLength: 1000 })
    @IsOptional()
    @IsString()
    @MaxLength(1000)
    note?: string;
}

// ─── Flash sales ──────────────────────────────────────────────────────────────

export class FlashItemDto implements FlashItemInput {
    @ApiProperty({ example: 88 })
    @Type(() => Number)
    @IsInt()
    storeProductId: number;

    @ApiPropertyOptional({ example: 39, description: "Flash price (< selling price). Or send discountPercent." })
    @ValidateIf((dto: FlashItemDto) => dto.discountPercent === undefined)
    @IsNumber(decimal(2))
    @Min(0.01)
    flashPrice?: number;

    @ApiPropertyOptional({ example: 25, minimum: 1, maximum: 90, description: "% off the current selling price" })
    @IsOptional()
    @IsNumber(decimal(2))
    @Min(1)
    @Max(90)
    discountPercent?: number;

    @ApiPropertyOptional({ example: 100, minimum: 1, description: "Units sold at the flash price in total (default: unlimited)" })
    @IsOptional()
    @IsInt()
    @Min(1)
    qtyLimit?: number;
}

/** Start / schedule a flash sale on one or more listings (replaces any current one on them). */
export class FlashSaleDto implements FlashSaleInput {
    @ApiProperty({ example: "2026-10-23T12:00:00.000Z", format: "date-time" })
    @IsDateString()
    startsAt: string;

    @ApiProperty({ example: "2026-10-23T14:00:00.000Z", format: "date-time", description: "After startsAt; at most 14 days later" })
    @IsDateString()
    endsAt: string;

    @ApiPropertyOptional({ example: 2, minimum: 1, description: "Max units per order at the flash price" })
    @IsOptional()
    @IsInt()
    @Min(1)
    maxPerOrder?: number;

    @ApiProperty({ type: () => [FlashItemDto], minItems: 1, maxItems: 200 })
    @IsArray()
    @ArrayMinSize(1)
    @ArrayMaxSize(200)
    @ValidateNested({ each: true })
    @Type(() => FlashItemDto)
    items: FlashItemDto[];
}

export class EndFlashSaleDto {
    @ApiProperty({ type: [Number], example: [88, 91], minItems: 1, maxItems: 200 })
    @IsArray()
    @ArrayMinSize(1)
    @ArrayMaxSize(200)
    @Type(() => Number)
    @IsInt({ each: true })
    storeProductIds: number[];
}

export class FlashListQuery extends PageQueryDto implements FlashListInput {
    @ApiPropertyOptional({ enum: ["live", "upcoming", "ended", "all"], default: "all" })
    @IsOptional()
    @IsIn(["live", "upcoming", "ended", "all"])
    state?: "live" | "upcoming" | "ended" | "all";
}

export class ExpiryQuery extends PageQueryDto implements ExpiryInput {
    @ApiPropertyOptional({ enum: EXPIRY_BUCKETS, description: "Omit for bucket totals only; send to list that bucket's batches" })
    @IsOptional()
    @IsIn(EXPIRY_BUCKETS)
    bucket?: ExpiryBucket;
}

export class LowStockQuery extends PageQueryDto implements LowStockInput {
    @ApiPropertyOptional({ example: 14, minimum: 1, maximum: 90, default: 14, description: "Sales window for the daily velocity" })
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    @Max(90)
    days?: number;

    @ApiPropertyOptional({ example: 7, minimum: 1, maximum: 60, default: 7, description: "Days of stock the suggested reorder should cover" })
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    @Max(60)
    coverDays?: number;
}

export class AdjustStockDto implements AdjustStockInput {
    @ApiProperty({ example: 88 })
    @Type(() => Number)
    @IsInt()
    storeProductId: number;

    @ApiPropertyOptional({ example: 412, description: "Required for batch-tracked listings" })
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    batchId?: number;

    @ApiProperty({ example: -2, description: "Signed: +n = stock increase (ADJUSTMENT only), -n = stock loss" })
    @IsInt()
    delta: number;

    @ApiProperty({ enum: ADJUST_TYPES, example: StockMovementType.DAMAGE })
    @IsIn(ADJUST_TYPES as unknown as string[])
    type: AdjustType;

    @ApiPropertyOptional({ example: "Cycle count correction", maxLength: 255 })
    @IsOptional()
    @IsString()
    @MaxLength(255)
    note?: string;

    @ApiPropertyOptional({ example: "adj-88-2026-10-20-01", maxLength: 64, description: "Same key twice = applied once" })
    @IsOptional()
    @IsString()
    @MaxLength(64)
    idempotencyKey?: string;
}

export class StockOutItemDto implements StockOutItemInput {
    @ApiProperty({ example: 88 })
    @Type(() => Number)
    @IsInt()
    storeProductId: number;

    @ApiPropertyOptional({ example: 412, description: "Take from this batch. Omit to pick FEFO (earliest expiry first)." })
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    batchId?: number;

    @ApiProperty({ example: 3, minimum: 1, description: "Units to remove (positive)" })
    @IsInt()
    @Min(1)
    quantity: number;
}

/** Remove stock for one reason (damage, loss, vendor return...). All lines succeed or none. */
export class StockOutDto implements StockOutInput {
    @ApiProperty({ enum: STOCK_OUT_REASONS, example: StockMovementType.VENDOR_RETURN })
    @IsIn(STOCK_OUT_REASONS as unknown as string[])
    reason: StockOutReason;

    @ApiPropertyOptional({ example: "Returned leaking packs to supplier", maxLength: 255 })
    @IsOptional()
    @IsString()
    @MaxLength(255)
    note?: string;

    @ApiPropertyOptional({ example: "so-2026-10-20-7", maxLength: 56, description: "Same key twice = applied once" })
    @IsOptional()
    @IsString()
    @MaxLength(56)
    idempotencyKey?: string;

    @ApiProperty({ type: () => [StockOutItemDto], minItems: 1, maxItems: 100 })
    @IsArray()
    @ArrayMinSize(1)
    @ArrayMaxSize(100)
    @ValidateNested({ each: true })
    @Type(() => StockOutItemDto)
    items: StockOutItemDto[];
}

export class BatchStatusDto {
    @ApiProperty({ enum: BatchStatus, example: BatchStatus.ACTIVE })
    @IsEnum(BatchStatus)
    status: BatchStatus;

    @ApiPropertyOptional({ example: 30, description: "Discounted price for a near-expiry batch (<= batch MRP)" })
    @IsOptional()
    @IsNumber()
    @Min(0)
    clearancePrice?: number;
}

// =====================================================================
// Queries
// =====================================================================

/** `GET catalog` — admin catalogue browse with this store's listing state. */
/** "1,2,3" or repeated `?x=1&x=2` → number[] (query strings). */
const IdList = () =>
    Transform(({ value }) =>
        (Array.isArray(value) ? value : String(value).split(","))
            .map((v: unknown) => String(v).trim())
            .filter(Boolean)
            .map(Number),
    );

/** "Add from catalog" — category facet. Only categories with PUBLISHED products (in their subtree) are returned. */
export class CatalogCategoryQuery extends PageQueryDto implements CatalogCategoryInput {
    @ApiPropertyOptional({ example: "dairy", maxLength: 100, description: "Name (any language) or slug. Matches return their `path`." })
    @IsOptional()
    @IsString()
    @MaxLength(100)
    q?: string;

    @ApiPropertyOptional({ example: 0, description: "Children of this category (0 = top level). Omit for all levels (flat)." })
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(0)
    parentId?: number;

    @ApiPropertyOptional({ enum: ["flat", "tree"], default: "flat", description: "`tree` = nested `children`, no paging" })
    @IsOptional()
    @IsIn(["flat", "tree"])
    view?: "flat" | "tree";

    @ApiPropertyOptional({
        enum: ["all", "listed", "unlisted", "to_add"],
        default: "all",
        description: "`listed` = has products with a listed variation; `unlisted` = has products with no variation listed; `to_add` = has products with at least one variation still to add",
    })
    @IsOptional()
    @IsIn(["all", "listed", "unlisted", "to_add"])
    listed?: "all" | "listed" | "unlisted" | "to_add";

    @ApiPropertyOptional({ type: [Number], example: [4, 9], description: "Count only products of these brands (comma separated)" })
    @IsOptional()
    @IdList()
    @IsArray()
    @ArrayMaxSize(50)
    @IsInt({ each: true })
    brandIds?: number[];

    @ApiPropertyOptional({ enum: CATALOG_CATEGORY_SORTS, default: "position" })
    @IsOptional()
    @IsIn(CATALOG_CATEGORY_SORTS)
    sort?: (typeof CATALOG_CATEGORY_SORTS)[number];
}

/** "Add from catalog" — brand facet. Only brands with PUBLISHED products are returned. */
export class CatalogBrandQuery extends PageQueryDto implements CatalogBrandInput {
    @ApiPropertyOptional({ example: "amul", maxLength: 100, description: "Name (any language) or slug" })
    @IsOptional()
    @IsString()
    @MaxLength(100)
    q?: string;

    @ApiPropertyOptional({ type: [Number], example: [12], description: "Only brands with products in these categories (sub-categories included; comma separated)" })
    @IsOptional()
    @IdList()
    @IsArray()
    @ArrayMaxSize(50)
    @IsInt({ each: true })
    categoryIds?: number[];

    @ApiPropertyOptional({ enum: ["all", "listed", "unlisted", "to_add"], default: "all", description: "Same meaning as for categories" })
    @IsOptional()
    @IsIn(["all", "listed", "unlisted", "to_add"])
    listed?: "all" | "listed" | "unlisted" | "to_add";

    @ApiPropertyOptional({ enum: CATALOG_BRAND_SORTS, default: "name_asc" })
    @IsOptional()
    @IsIn(CATALOG_BRAND_SORTS)
    sort?: (typeof CATALOG_BRAND_SORTS)[number];
}

/** Store manager → admin: something in the catalogue product (or one variation) needs fixing. */
export class CatalogChangeRequestDto implements CatalogChangeRequestInput {
    @ApiPropertyOptional({ example: 88, description: "One variation; omit for the whole product" })
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    variantId?: number;

    @ApiProperty({ enum: CATALOG_CHANGE_FIELDS, isArray: true, example: ["IMAGES", "MRP"] })
    @IsArray()
    @ArrayMinSize(1)
    @ArrayUnique()
    @IsIn(CATALOG_CHANGE_FIELDS, { each: true })
    fields: (typeof CATALOG_CHANGE_FIELDS)[number][];

    @ApiProperty({ example: "Pack photo is the old design; new MRP printed is 58", minLength: 5, maxLength: 2000 })
    @IsString()
    @MinLength(5)
    @MaxLength(2000)
    note: string;

    @ApiPropertyOptional({
        type: [Number],
        example: [9401],
        maxItems: 10,
        description: "Suggested files: your own uploads with purpose PRODUCT (POST /account/media). The admin can attach them to the gallery when approving.",
    })
    @IsOptional()
    @IsArray()
    @ArrayMaxSize(10)
    @ArrayUnique()
    @Type(() => Number)
    @IsInt({ each: true })
    mediaIds?: number[];
}

export class CatalogQuery extends PageQueryDto implements CatalogInput {
    @ApiPropertyOptional({ example: "milk", maxLength: 100, description: "Title / keyword / SKU search" })
    @IsOptional()
    @IsString()
    @MaxLength(100)
    q?: string;

    @ApiPropertyOptional({ example: 12, description: "Sub-categories included" })
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    categoryId?: number;

    @ApiPropertyOptional({ type: [Number], example: [12, 15], description: "Several categories (sub-categories included; comma separated)" })
    @IsOptional()
    @IdList()
    @IsArray()
    @ArrayMaxSize(50)
    @IsInt({ each: true })
    categoryIds?: number[];

    @ApiPropertyOptional({ example: 4 })
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    brandId?: number;

    @ApiPropertyOptional({ type: [Number], example: [4, 9], description: "Several brands (comma separated)" })
    @IsOptional()
    @IdList()
    @IsArray()
    @ArrayMaxSize(50)
    @IsInt({ each: true })
    brandIds?: number[];

    @ApiPropertyOptional({ type: [Number], example: [3], description: "Category groups (their categories, sub-categories included; comma separated). With categoryIds too, only categories in both" })
    @IsOptional()
    @IdList()
    @IsArray()
    @ArrayMaxSize(20)
    @IsInt({ each: true })
    groupIds?: number[];

    @ApiPropertyOptional({
        enum: ["all", "listed", "unlisted", "to_add"],
        default: "all",
        description: "`listed` = at least one variation listed; `unlisted` = none listed; `to_add` = at least one active variation not listed yet",
    })
    @IsOptional()
    @IsIn(["all", "listed", "unlisted", "to_add"])
    listed?: "all" | "listed" | "unlisted" | "to_add";

    @ApiPropertyOptional({ enum: StoreListingStatus, description: "Products with at least one variation listed in this status" })
    @IsOptional()
    @IsEnum(StoreListingStatus)
    status?: StoreListingStatus;

    @ApiPropertyOptional({ enum: ["in", "out"], description: "Products with at least one listed variation in stock (`in`) / with nothing sellable (`out`)" })
    @IsOptional()
    @IsIn(["in", "out"])
    stock?: "in" | "out";

    @ApiPropertyOptional({ enum: ["newest", "oldest", "name", "updated"], default: "newest" })
    @IsOptional()
    @IsIn(["newest", "oldest", "name", "updated"])
    sort?: "newest" | "oldest" | "name" | "updated";
}

/** `GET listings` filters. */
export class StockListQuery extends PageQueryDto implements StockListInput {
    @ApiPropertyOptional({ example: 12 })
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    categoryId?: number;

    @ApiPropertyOptional({ type: [Number], example: [12, 15], description: "Several categories (sub-categories included; comma separated)" })
    @IsOptional()
    @IdList()
    @IsArray()
    @ArrayMaxSize(50)
    @IsInt({ each: true })
    categoryIds?: number[];

    @ApiPropertyOptional({ type: [Number], example: [3], description: "Category groups (their categories, sub-categories included; comma separated). With categoryIds too, only categories in both" })
    @IsOptional()
    @IdList()
    @IsArray()
    @ArrayMaxSize(20)
    @IsInt({ each: true })
    groupIds?: number[];

    @ApiPropertyOptional({ type: [Number], example: [4, 9], description: "Brands (comma separated)" })
    @IsOptional()
    @IdList()
    @IsArray()
    @ArrayMaxSize(50)
    @IsInt({ each: true })
    brandIds?: number[];

    @ApiPropertyOptional({ example: 345 })
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    productId?: number;

    @ApiPropertyOptional({
        enum: STOCK_FILTERS,
        description: "in = sellable > 0, low = sellable <= threshold, out = sellable <= 0, reserved = has reserved units",
    })
    @IsOptional()
    @IsIn(STOCK_FILTERS)
    stock?: StockFilter;

    @ApiPropertyOptional({ enum: StorePriceStatus, description: "MRP_RESET = price discarded after an admin MRP cut (review needed)" })
    @IsOptional()
    @IsEnum(StorePriceStatus)
    priceStatus?: StorePriceStatus;

    @ApiPropertyOptional({ enum: StoreListingStatus, description: "Listing status (PENDING_APPROVAL = waiting for admin barcode approval)" })
    @IsOptional()
    @IsEnum(StoreListingStatus)
    status?: StoreListingStatus;

    @ApiPropertyOptional({ example: true, description: "Live on the storefront right now (status ACTIVE and catalogue live)" })
    @IsOptional()
    @QueryBool()
    @IsBoolean()
    isActive?: boolean;

    @ApiPropertyOptional({ example: "amul", maxLength: 100 })
    @IsOptional()
    @IsString()
    @MaxLength(100)
    q?: string;
}

/** `GET movements` — store-wide stock ledger. */
export class LedgerQuery extends PageQueryDto implements LedgerInput {
    @ApiPropertyOptional({ example: 88 })
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    storeProductId?: number;

    @ApiPropertyOptional({ enum: StockMovementType, isArray: true, example: ["SALE", "DAMAGE"], description: "Comma separated or repeated" })
    @IsOptional()
    @Transform(({ value }) => (typeof value === "string" ? value.split(",").filter(Boolean) : value))
    @IsArray()
    @ArrayUnique()
    @IsEnum(StockMovementType, { each: true })
    types?: StockMovementType[];

    @ApiPropertyOptional({ example: "2026-10-01", format: "date" })
    @IsOptional()
    @IsDateString()
    from?: string;

    @ApiPropertyOptional({ example: "2026-10-20", format: "date", description: "Inclusive" })
    @IsOptional()
    @IsDateString()
    to?: string;
}

/** `GET listings/:id/movements` pagination. */
export class MovementQuery extends PageQueryDto implements MovementInput {}

/** `GET receipts` — goods receipts (GRN). */
export class ReceiptListQuery extends PageQueryDto implements ReceiptListInput {
    @ApiPropertyOptional({ example: "dairy", maxLength: 100, description: "GRN number, supplier name or invoice no" })
    @IsOptional()
    @IsString()
    @MaxLength(100)
    q?: string;

    @ApiPropertyOptional({ example: "2026-10-01", format: "date" })
    @IsOptional()
    @IsDateString()
    from?: string;

    @ApiPropertyOptional({ example: "2026-10-20", format: "date" })
    @IsOptional()
    @IsDateString()
    to?: string;
}

/** `GET expiring?days=14`. */
export class ExpiringQuery {
    @ApiPropertyOptional({ example: 7, minimum: 1, description: "Default / max from config" })
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    days?: number;
}

/** `GET admin/inventory/overview` — admin store picker. */
export class InventoryOverviewQuery extends PageQueryDto {
    @ApiPropertyOptional({ example: "gulshan", maxLength: 100, description: "Store code, name or city" })
    @IsOptional()
    @IsString()
    @MaxLength(100)
    q?: string;
}
