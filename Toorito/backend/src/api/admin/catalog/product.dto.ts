import {
    MAX_VARIANTS,
    MAX_GALLERY_ITEMS,
    MAX_VARIANT_MEDIA,
    PRODUCT_SORTS,
    ProductSort,
    PRODUCT_TYPES,
    ProductType,
    NUTRITION_BASES,
    NutritionBasis,
    ListProductsInput,
    CheckProductSlugInput,
    NameValueInput,
    NutritionMetaInput,
    NutritionColumnInput,
    NutritionRowInput,
    NutritionTableInput,
    TranslationInput,
    BarcodeInput,
    VariantOptionImageInput,
    VariantInput,
    UpdateVariantInput,
    UpdateProductVariantInput,
    ProductBaseInput,
    CreateProductInput,
    UpdateProductInput,
    UpdateProductStatusInput,
    ProductVariantOptionAssignmentInput,
    UpdateProductOptionsInput,
    QuickEditVariantInput,
    QuickEditProductInput,
    BulkProductIdsInput,
    BulkProductStatusInput,
    BulkAssignProductsInput,
    CheckSkuInput,
    GenerateSkuItemInput,
    GenerateSkusInput,
    ManufacturerSuggestionInput,
} from "@modules/catalog/product/product.types";
import {
    IsBigIntArray,
    IsBigIntId,
} from "@common/decorators/bigint-id.decorator";
import { PageQueryDto } from "@common/dto/page-query.dto";
import {
    IsSupportedLanguage,
} from "@common/validators/is-supported-language.validator";
import {
    ApiProperty,
    ApiPropertyOptional,
    OmitType,
    PartialType,
} from "@nestjs/swagger";
import {
    BarcodeType,
    DietType,
    ProductStatus,
    UnitType,
} from "@prisma-client/enums";
import { Transform, Type } from "class-transformer";
import {
    ArrayMaxSize,
    ArrayMinSize,
    ArrayUnique,
    IsArray,
    IsBoolean,
    IsDate,
    IsEnum,
    IsIn,
    IsInt,
    IsNumber,
    IsOptional,
    IsString,
    Matches,
    Max,
    MaxLength,
    Min,
    ValidateNested,
} from "class-validator";
/** Max ids per bulk request. */
export const MAX_BULK_IDS = 100;

/** Letters, digits, `.`, `_`, `-`, `/`; must start with a letter or digit. */
const SKU_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._\-/]*$/;

const trimString = ({ value }: { value: unknown }) =>
    typeof value === "string" ? value.trim() : value;

/** Trims; an empty string becomes `undefined` (= auto-generate). */
const optionalSku = ({ value }: { value: unknown }) =>
    typeof value === "string" ? value.trim() || undefined : value;

/** Sorts supported by the public storefront list (price / newest only). */
export const STOREFRONT_SORTS = ["new", "price_asc", "price_desc"] as const;
export type StorefrontSort = (typeof STOREFRONT_SORTS)[number];

/* List Products Query */
export class ListProductsQuery extends PageQueryDto implements ListProductsInput {
    @ApiPropertyOptional({
        description:
            "Free text. Every word must match title, brand, keywords or SKU",
    })
    @IsOptional()
    @IsString()
    @MaxLength(100)
    @Transform(trimString)
    q?: string;

    @ApiPropertyOptional({ enum: ProductStatus })
    @IsOptional()
    @IsEnum(ProductStatus)
    status?: ProductStatus;

    @ApiPropertyOptional({
        enum: PRODUCT_TYPES,
        description:
            "`simple` = no option groups, `variable` = has option groups",
    })
    @IsOptional()
    @IsIn(PRODUCT_TYPES)
    type?: ProductType;

    @ApiPropertyOptional({
        type: [String],
        example: ["1", "2"],
        description: "Exclude products with these IDs",
    })
    @IsOptional()
    @IsBigIntArray({ max: 100 })
    excludeIds?: bigint[];

    @ApiPropertyOptional({
        type: String,
        description:
            "Admin list: only products listed in this store. Storefront: the store to browse",
    })
    @IsOptional()
    @IsBigIntId()
    storeId?: bigint;

    @ApiPropertyOptional({
        type: String,
        description: "One category (includes sub-categories). Same as `categoryIds` with one value",
    })
    @IsOptional()
    @IsBigIntId()
    categoryId?: bigint;

    @ApiPropertyOptional({
        type: [String],
        example: ["21", "22"],
        description:
            "Any of these categories, sub-categories included (`?categoryIds=21,22` or repeated `?categoryIds=21&categoryIds=22`)",
    })
    @IsOptional()
    @IsBigIntArray({ max: 50 })
    categoryIds?: bigint[];

    @ApiPropertyOptional({
        type: [String],
        example: ["3"],
        description:
            "Any category of these category groups, sub-categories included. With `categoryIds` too, only categories in both",
    })
    @IsOptional()
    @IsBigIntArray({ max: 20 })
    groupIds?: bigint[];

    @ApiPropertyOptional({ type: String, description: "One brand. Same as `brandIds` with one value" })
    @IsOptional()
    @IsBigIntId()
    brandId?: bigint;

    @ApiPropertyOptional({
        type: [String],
        example: ["5", "9"],
        description: "Any of these brands",
    })
    @IsOptional()
    @IsBigIntArray({ max: 50 })
    brandIds?: bigint[];

    @ApiPropertyOptional({
        enum: PRODUCT_SORTS,
        default: "new",
        description:
            "`new` = newest first. `price_*` sorts by the cheapest variant MRP, `name_*` by the default-language title",
    })
    @IsOptional()
    @IsIn(PRODUCT_SORTS)
    sort?: ProductSort;

    @ApiPropertyOptional({
        type: Boolean,
        description:
            "Set true to list ONLY soft-deleted products (the trash) instead of live ones",
    })
    @IsOptional()
    @Transform(
        ({ value }) => value === true || value === "true" || value === "1",
    )
    @IsBoolean()
    deleted?: boolean;

    @ApiPropertyOptional({ description: "Partial SKU match on live variants" })
    @IsOptional()
    @IsString()
    @MaxLength(100)
    sku?: string;

    @ApiPropertyOptional({
        description: "Partial barcode match on live variants",
    })
    @IsOptional()
    @IsString()
    @MaxLength(100)
    barcode?: string;
}

/* Check product slug */
export class CheckProductSlugQuery implements CheckProductSlugInput {
    @ApiPropertyOptional({
        example: "Organic Basmati Rice",
        description: "Used to generate the slug when `slug` is not sent",
    })
    @IsOptional()
    @IsString()
    @MaxLength(255)
    title?: string;

    @ApiPropertyOptional({ example: "organic-basmati-rice" })
    @IsOptional()
    @IsString()
    @MaxLength(120)
    slug?: string;

    @ApiPropertyOptional({
        type: String,
        description: "Product being edited; it may keep its own slug",
    })
    @IsOptional()
    @IsBigIntId()
    excludeId?: bigint;
}

/* ============ multi-language building blocks ============ */

/** One `Name: Value` pair (key features, custom attributes). */
export class NameValueDto implements NameValueInput {
    @IsString()
    @MaxLength(100)
    name: string;

    @IsString()
    @MaxLength(500)
    value: string;
}

/**
 * Language-neutral nutrition settings, stored on the product.
 * The table itself is per language (see {@link NutritionTableDto}).
 */
export class NutritionMetaDto implements NutritionMetaInput {
    @ApiProperty({ enum: NUTRITION_BASES })
    @IsIn(NUTRITION_BASES)
    basis: NutritionBasis;

    @ApiPropertyOptional({ example: "30g" })
    @IsOptional()
    @IsString()
    @MaxLength(50)
    servingSize?: string;

    @IsOptional()
    @IsNumber({ maxDecimalPlaces: 2 })
    @Min(0)
    servingsPerPack?: number;
}

/** Table header cell. `children` = sub-columns (max 2 header levels). */
export class NutritionColumnDto implements NutritionColumnInput {
    @IsString()
    @MaxLength(100)
    label: string;

    @IsOptional()
    @IsArray()
    @ArrayMaxSize(10)
    @ValidateNested({ each: true })
    @Type(() => NutritionColumnDto)
    children?: NutritionColumnDto[];
}

/**
 * Table row. `values` has one cell per leaf column (or is empty for a
 * group heading row). `children` = sub-rows (max 3 levels).
 */
export class NutritionRowDto implements NutritionRowInput {
    @IsString()
    @MaxLength(100)
    label: string;

    @IsArray()
    @ArrayMaxSize(30)
    @IsString({ each: true })
    @MaxLength(100, { each: true })
    values: string[];

    @IsOptional()
    @IsArray()
    @ArrayMaxSize(50)
    @ValidateNested({ each: true })
    @Type(() => NutritionRowDto)
    children?: NutritionRowDto[];
}

/**
 * Free-form nutrition table, drawn like a word-processor table. Every
 * language must use the same column / row structure; only the text differs.
 */
export class NutritionTableDto implements NutritionTableInput {
    @IsArray()
    @ArrayMinSize(1)
    @ArrayMaxSize(10)
    @ValidateNested({ each: true })
    @Type(() => NutritionColumnDto)
    columns: NutritionColumnDto[];

    @IsArray()
    @ArrayMaxSize(100)
    @ValidateNested({ each: true })
    @Type(() => NutritionRowDto)
    rows: NutritionRowDto[];
}

/**
 * Product Translation (one per language). Every text a shopper reads lives
 * here. All fields except `lang` are optional so a draft can be saved
 * half-filled; publishing requires a default-language `title`.
 */
export class TranslationDto implements TranslationInput {
    @Transform(({ value }) =>
        typeof value === "string" ? value.trim().toLowerCase() : value,
    )
    @IsSupportedLanguage()
    lang: string;

    @IsOptional()
    @IsString()
    @MaxLength(255)
    title?: string;

    @IsOptional()
    @IsString()
    @MaxLength(500)
    shortDescription?: string;

    @IsOptional()
    @IsString()
    description?: string;

    @ApiPropertyOptional({ type: [NameValueDto] })
    @IsOptional()
    @IsArray()
    @ArrayMaxSize(30)
    @ValidateNested({ each: true })
    @Type(() => NameValueDto)
    keyFeatures?: NameValueDto[];

    @IsOptional()
    @IsString()
    ingredients?: string;

    @IsOptional()
    @IsString()
    @MaxLength(500)
    storageInstructions?: string;

    @IsOptional()
    @IsString()
    @MaxLength(500)
    manufacturerAddress?: string;

    @IsOptional()
    @IsArray()
    @ArrayMaxSize(30)
    @IsString({ each: true })
    @MaxLength(100, { each: true })
    allergens?: string[];

    @ApiPropertyOptional({ type: [NameValueDto] })
    @IsOptional()
    @IsArray()
    @ArrayMaxSize(50)
    @ValidateNested({ each: true })
    @Type(() => NameValueDto)
    attributes?: NameValueDto[];

    @IsOptional()
    @ValidateNested()
    @Type(() => NutritionTableDto)
    nutrition?: NutritionTableDto;

    /** Additional search terms, any script. Stored so search text can be rebuilt. */
    @IsOptional()
    @IsArray()
    @ArrayMaxSize(50)
    @IsString({ each: true })
    @MaxLength(100, { each: true })
    keywords?: string[];

    /** Search engine listing. Falls back to title / short description. */
    @IsOptional()
    @IsString()
    @MaxLength(255)
    seoTitle?: string;

    @IsOptional()
    @IsString()
    @MaxLength(500)
    seoDescription?: string;
}

/* Barcode */
export class BarcodeDto implements BarcodeInput {
    @Transform(trimString)
    @IsString()
    @MaxLength(64)
    code: string;

    @IsOptional()
    @IsEnum(BarcodeType)
    type?: BarcodeType;

    @IsOptional()
    @IsBoolean()
    isPrimary?: boolean;
}

/** Per-variant image override for one of its option values (image-type option groups). */
export class VariantOptionImageDto implements VariantOptionImageInput {
    @IsBigIntId()
    optionValueId: bigint;

    @IsBigIntId()
    mediaId: bigint;
}

/* Variant */
export class VariantDto implements VariantInput {
    @ApiPropertyOptional({
        description:
            "Globally unique. Omit to auto-generate from the title and option values",
    })
    @IsOptional()
    @Transform(optionalSku)
    @IsString()
    @MaxLength(64)
    @Matches(SKU_PATTERN)
    sku?: string;

    /**
     * Maximum retail price, tax inclusive. Stores can never sell above it.
     * Required on every variant, drafts included.
     */
    @ApiProperty({ example: 120, minimum: 0.01 })
    @IsNumber({ maxDecimalPlaces: 2 })
    @Min(0.01)
    mrp: number;

    /** Sold by (KG, PIECE, GRAM, DOZEN ...). */
    @IsOptional()
    @IsEnum(UnitType)
    unit?: UnitType;

    /** `{unit}` per pack, e.g. 5 (KG). */
    @IsOptional()
    @IsNumber({ maxDecimalPlaces: 3 })
    @Min(0)
    unitValue?: number;

    /** Shipping weight; only sent when it differs ("by checking"). */
    @IsOptional()
    @IsInt()
    @Min(0)
    weightGrams?: number;

    /** One option value per product option, e.g. [Size-L, Flavour-Chocolate]. */
    @IsOptional()
    @IsBigIntArray({ max: 100 })
    optionValueIds?: bigint[];

    @ApiPropertyOptional({ type: [VariantOptionImageDto] })
    @IsOptional()
    @IsArray()
    @ArrayMaxSize(100)
    @ValidateNested({ each: true })
    @Type(() => VariantOptionImageDto)
    optionImages?: VariantOptionImageDto[];

    @IsOptional()
    @IsArray()
    @ArrayMaxSize(10)
    @ValidateNested({ each: true })
    @Type(() => BarcodeDto)
    barcodes?: BarcodeDto[];

    /** Variant gallery (images / videos). */
    @IsOptional()
    @IsBigIntArray({ max: MAX_VARIANT_MEDIA })
    mediaIds?: bigint[];

    /**
     * Audio clip for this variant (e.g. a different bell sound per model),
     * picked from the media library. `null` removes it; omitted = keep.
     */
    @ApiPropertyOptional({ type: String, nullable: true })
    @IsOptional()
    @IsBigIntId()
    audioMediaId?: bigint | null;

    @IsOptional()
    @IsInt()
    @Min(0)
    position?: number;

    @IsOptional()
    @IsBoolean()
    isActive?: boolean;
}

/* Update Variant (PATCH variants/:id). SKU and option values are not editable here. */
export class UpdateVariantDto implements UpdateVariantInput {
    @IsOptional()
    @IsNumber({ maxDecimalPlaces: 2 })
    @Min(0.01)
    mrp?: number;

    @IsOptional()
    @IsEnum(UnitType)
    unit?: UnitType;

    @IsOptional()
    @IsNumber({ maxDecimalPlaces: 3 })
    @Min(0)
    unitValue?: number;

    @IsOptional()
    @IsInt()
    @Min(0)
    weightGrams?: number;

    @IsOptional()
    @IsBoolean()
    isActive?: boolean;

    @IsOptional()
    @IsInt()
    @Min(0)
    position?: number;

    @IsOptional()
    @IsArray()
    @ArrayMaxSize(10)
    @ValidateNested({ each: true })
    @Type(() => BarcodeDto)
    barcodes?: BarcodeDto[];

    @IsOptional()
    @IsBigIntArray({ max: MAX_VARIANT_MEDIA })
    mediaIds?: bigint[];

    /**
     * Audio clip for this variant (e.g. a different bell sound per model),
     * picked from the media library. `null` removes it; omitted = keep.
     */
    @ApiPropertyOptional({ type: String, nullable: true })
    @IsOptional()
    @IsBigIntId()
    audioMediaId?: bigint | null;
}

export class UpdateProductVariantDto extends VariantDto implements UpdateProductVariantInput {
    @ApiPropertyOptional({ description: "Existing variant id (edit)" })
    @IsOptional()
    @IsBigIntId()
    id?: bigint;
}

/**
 * Product Base (language-neutral fields).
 *
 * The thumbnail is not sent: it is always the first gallery item, which must
 * be an image.
 */
export class ProductBaseDto implements ProductBaseInput {
    @ApiPropertyOptional({ type: String, nullable: true })
    @IsOptional()
    @IsBigIntId()
    brandId?: bigint | null;

    /** Audio clip (e.g. a calling-bell sound) picked from the media library. */
    @ApiPropertyOptional({ type: String, nullable: true })
    @IsOptional()
    @IsBigIntId()
    audioMediaId?: bigint | null;

    @IsOptional()
    @IsEnum(DietType)
    dietType?: DietType;

    @IsOptional()
    @IsString()
    @Matches(/^\d{4,8}$/)
    hsnCode?: string;

    @IsOptional()
    @IsNumber({ maxDecimalPlaces: 2 })
    @Min(0)
    @Max(100)
    gstRate?: number;

    /** ISO 3166-1 alpha-2, e.g. IN. */
    @IsOptional()
    @Transform(({ value }) =>
        typeof value === "string" ? value.trim().toUpperCase() : value,
    )
    @Matches(/^[A-Z]{2}$/)
    countryOfOrigin?: string;

    @IsOptional()
    @IsInt()
    @Min(1)
    shelfLifeDays?: number;

    @IsOptional()
    @IsBoolean()
    isPerishable?: boolean;

    @IsOptional()
    @IsString()
    @MaxLength(191)
    manufacturerName?: string;

    @IsOptional()
    @ValidateNested()
    @Type(() => NutritionMetaDto)
    nutrition?: NutritionMetaDto;

    /** Product gallery (images / videos). The first item must be an image and becomes the thumbnail. */
    @IsOptional()
    @IsBigIntArray({ max: MAX_GALLERY_ITEMS })
    mediaIds?: bigint[];
}

/**
 * Create Product.
 *
 * DRAFT (default): only one of title / category / a variant is required.
 * PUBLISHED: every publishing rule must pass (see the publish endpoint).
 */
export class CreateProductDto extends ProductBaseDto implements CreateProductInput {
    @IsOptional()
    @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
    @MaxLength(120)
    slug?: string;

    @ApiPropertyOptional({ type: String })
    @IsOptional()
    @IsBigIntId()
    categoryId?: bigint;

    @IsOptional()
    @IsArray()
    @ArrayMaxSize(20)
    @ValidateNested({ each: true })
    @Type(() => TranslationDto)
    translations?: TranslationDto[];

    /** Ordered option groups, e.g. [Size, Flavour]. Empty = simple product. */
    @IsOptional()
    @IsBigIntArray({ max: 100 })
    optionGroupIds?: bigint[];

    @IsOptional()
    @IsArray()
    @ArrayMaxSize(MAX_VARIANTS)
    @ValidateNested({ each: true })
    @Type(() => VariantDto)
    variants?: VariantDto[];

    @ApiPropertyOptional({
        enum: [ProductStatus.DRAFT, ProductStatus.PUBLISHED],
        default: ProductStatus.DRAFT,
    })
    @IsOptional()
    @IsIn([ProductStatus.DRAFT, ProductStatus.PUBLISHED])
    status?: ProductStatus;
}

/* Update Product */
export class UpdateProductDto extends PartialType(
    OmitType(CreateProductDto, ["variants", "status"] as const),
) implements UpdateProductInput {
    // optionGroupIds: omitted = keep, [] = simple, non-empty = variable

    @ApiPropertyOptional({
        type: [UpdateProductVariantDto],
        description:
            "Full variant list. id = edit, no id = add, missing = delete.",
    })
    @IsOptional()
    @IsArray()
    @ArrayMaxSize(MAX_VARIANTS)
    @ValidateNested({ each: true })
    @Type(() => UpdateProductVariantDto)
    variants?: UpdateProductVariantDto[];

    @ApiPropertyOptional({
        enum: ProductStatus,
        description:
            "Omit to keep. A PUBLISHED product (new or current) must pass every publishing rule.",
    })
    @IsOptional()
    @IsEnum(ProductStatus)
    status?: ProductStatus;

    @ApiPropertyOptional({
        type: String,
        format: "date-time",
        description:
            "The `updatedAt` the form was loaded with. When the product changed since, the save is rejected with 409 instead of overwriting someone else's edit.",
    })
    @IsOptional()
    @Type(() => Date)
    @IsDate()
    expectedUpdatedAt?: Date;
}

/**
 * Single status endpoint (`PATCH admin/products/:id/status`). Any status can
 * move to any other; PUBLISHED runs every publish rule. Sending the current
 * status is a no-op (`changed: false`), so retries are safe.
 */
export class UpdateProductStatusDto implements UpdateProductStatusInput {
    @ApiProperty({ enum: ProductStatus })
    @IsEnum(ProductStatus)
    status: ProductStatus;

    @ApiPropertyOptional({
        type: String,
        format: "date-time",
        description: "Optional optimistic-lock check (see UpdateProductDto)",
    })
    @IsOptional()
    @Type(() => Date)
    @IsDate()
    expectedUpdatedAt?: Date;
}

/** Reconfigure product option groups and explicitly map every existing variant to the new values. */
export class ProductVariantOptionAssignmentDto implements ProductVariantOptionAssignmentInput {
    @IsBigIntId()
    id: bigint;

    @IsArray()
    @IsBigIntArray({ max: 100 })
    optionValueIds: bigint[];
}

export class UpdateProductOptionsDto implements UpdateProductOptionsInput {
    @ApiProperty({
        type: [Number],
        description:
            "Ordered option group IDs; may be empty only for a single default variant",
    })
    @ArrayUnique()
    @IsBigIntArray({ max: 100 })
    optionGroupIds: bigint[];

    @ApiProperty({
        type: [ProductVariantOptionAssignmentDto],
        description:
            "Must include every existing non-deleted variant exactly once",
    })
    @IsArray()
    @ArrayMinSize(1)
    @ArrayUnique((item: ProductVariantOptionAssignmentDto) => item.id)
    @ValidateNested({ each: true })
    @Type(() => ProductVariantOptionAssignmentDto)
    variants: ProductVariantOptionAssignmentDto[];
}

/* ============ listing: quick edit + bulk ============ */

export class QuickEditVariantDto implements QuickEditVariantInput {
    @IsBigIntId()
    id: bigint;

    @IsOptional()
    @IsNumber({ maxDecimalPlaces: 2 })
    @Min(0.01)
    mrp?: number;

    @IsOptional()
    @IsBoolean()
    isActive?: boolean;
}

/** Inline edit from the product list. Only the fields sent change. */
export class QuickEditProductDto implements QuickEditProductInput {
    @ApiPropertyOptional({ description: "Default-language title" })
    @IsOptional()
    @IsString()
    @MaxLength(255)
    title?: string;

    @IsOptional()
    @IsEnum(ProductStatus)
    status?: ProductStatus;

    @ApiPropertyOptional({ type: String })
    @IsOptional()
    @IsBigIntId()
    categoryId?: bigint;

    @ApiPropertyOptional({ type: String, nullable: true })
    @IsOptional()
    @IsBigIntId()
    brandId?: bigint | null;

    @ApiPropertyOptional({ type: [QuickEditVariantDto] })
    @IsOptional()
    @IsArray()
    @ArrayMaxSize(MAX_VARIANTS)
    @ValidateNested({ each: true })
    @Type(() => QuickEditVariantDto)
    variants?: QuickEditVariantDto[];

    @ApiPropertyOptional({ type: String, format: "date-time" })
    @IsOptional()
    @Type(() => Date)
    @IsDate()
    expectedUpdatedAt?: Date;
}

export class BulkProductIdsDto implements BulkProductIdsInput {
    @ApiProperty({ type: [String], example: ["101", "102"] })
    @ArrayMinSize(1)
    @IsBigIntArray({ max: MAX_BULK_IDS })
    ids: bigint[];
}

export class BulkProductStatusDto extends BulkProductIdsDto implements BulkProductStatusInput {
    @ApiProperty({ enum: ProductStatus })
    @IsEnum(ProductStatus)
    status: ProductStatus;
}

export class BulkAssignProductsDto extends BulkProductIdsDto implements BulkAssignProductsInput {
    @ApiPropertyOptional({ type: String })
    @IsOptional()
    @IsBigIntId()
    categoryId?: bigint;

    @ApiPropertyOptional({
        type: String,
        nullable: true,
        description: "null removes the brand",
    })
    @IsOptional()
    @IsBigIntId()
    brandId?: bigint | null;
}

/* ============ SKU tools ============ */

export class CheckSkuQuery implements CheckSkuInput {
    @Transform(trimString)
    @IsString()
    @MaxLength(64)
    @Matches(SKU_PATTERN)
    sku: string;

    @ApiPropertyOptional({
        type: String,
        description: "Variant being edited may keep its SKU",
    })
    @IsOptional()
    @IsBigIntId()
    excludeVariantId?: bigint;
}

export class GenerateSkuItemDto implements GenerateSkuItemInput {
    @ApiPropertyOptional({ type: [String] })
    @IsOptional()
    @IsBigIntArray({ max: 100 })
    optionValueIds?: bigint[];
}

/** Generates one unique SKU per variant row ("generate all SKUs" button). */
export class GenerateSkusDto implements GenerateSkusInput {
    @IsOptional()
    @IsString()
    @MaxLength(255)
    title?: string;

    @IsOptional()
    @IsString()
    @MaxLength(120)
    slug?: string;

    @ApiProperty({ type: [GenerateSkuItemDto] })
    @IsArray()
    @ArrayMinSize(1)
    @ArrayMaxSize(MAX_VARIANTS)
    @ValidateNested({ each: true })
    @Type(() => GenerateSkuItemDto)
    variants: GenerateSkuItemDto[];

    @ApiPropertyOptional({
        description: "SKUs already used in the form (treated as taken)",
    })
    @IsOptional()
    @IsArray()
    @ArrayMaxSize(MAX_VARIANTS * 2)
    @IsString({ each: true })
    reserved?: string[];

    @ApiPropertyOptional({
        type: String,
        description: "Product being edited; its own SKUs count as free",
    })
    @IsOptional()
    @IsBigIntId()
    excludeProductId?: bigint;
}

/* Manufacturer name / address suggestions from previous products */
export class ManufacturerSuggestionQuery implements ManufacturerSuggestionInput {
    @IsOptional()
    @IsString()
    @MaxLength(100)
    @Transform(trimString)
    q?: string;

    @ApiPropertyOptional({
        type: String,
        description: "Rank this brand's previous manufacturers first",
    })
    @IsOptional()
    @IsBigIntId()
    brandId?: bigint;

    @IsOptional()
    @Transform(({ value }) =>
        typeof value === "string" ? value.trim().toLowerCase() : value,
    )
    @IsSupportedLanguage()
    lang?: string;

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    @Max(30)
    limit?: number;
}

/* ============ store / storefront queries ============ */

/**
 * Public storefront query. Admin-only filters (status, type, SKU, barcode,
 * deleted, excludeIds) are removed, and `sort` is limited to what the
 * storefront list supports.
 */
export class StorefrontProductsQuery extends OmitType(ListProductsQuery, [
    "status",
    "type",
    "sku",
    "barcode",
    "deleted",
    "excludeIds",
    "sort",
] as const) {
    @ApiProperty({ type: Number, minimum: 1, description: "Resolved store ID" })
    @IsBigIntId()
    storeId: bigint;

    @ApiPropertyOptional({ enum: STOREFRONT_SORTS, default: "new" })
    @IsOptional()
    @IsIn(STOREFRONT_SORTS)
    sort?: StorefrontSort;
}

/**
 * Store managers / staff browse only PUBLISHED, non-deleted products, and the
 * store is always taken from the token, so none of these filters are exposed.
 */
export class StoreProductsQuery extends OmitType(ListProductsQuery, [
    "status",
    "deleted",
    "storeId",
] as const) {}

export class CatalogListQuery extends PageQueryDto {
    @IsOptional()
    @IsString()
    @MaxLength(100)
    q?: string;

    @IsOptional()
    @IsIn(["ACTIVE", "INACTIVE"])
    status?: "ACTIVE" | "INACTIVE";
}

export class CatalogDetailQuery {
    @IsOptional()
    @IsString()
    lang?: string;
}

/** Optional store context for the storefront product page. */
export class ProductDetailQuery {
    @IsOptional()
    @IsBigIntId()
    storeId?: bigint;
}

/** Store manager: append own READY product images to a product or one of its variants. */
export class StoreProductMediaDto {
    /** Media ids (purpose PRODUCT, READY images uploaded by you); appended in this order. */
    @IsBigIntArray({ max: MAX_GALLERY_ITEMS })
    @ArrayMinSize(1)
    mediaIds: bigint[];

    /** Add to this variant's photos instead of the product gallery. */
    @IsOptional()
    @IsBigIntId()
    variantId?: bigint;
}
