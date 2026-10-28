import { PageQueryDto } from "@common/dto/page-query.dto";
import {
    BarcodeType,
    DietType,
    ProductStatus,
    UnitType,
} from "@prisma-client/enums";

/** Plain input types of the product services (no decorators; the HTTP DTOs in src/api implement them). */


/** Maximum live variants per product. */
export const MAX_VARIANTS = 100;

/** Product gallery: images / videos, the first one (an image) is the thumbnail. */
export const MAX_GALLERY_ITEMS = 15;

/** Per-variant gallery: images / videos. */
export const MAX_VARIANT_MEDIA = 10;

/** Sorts supported by the admin / store product list. */
export const PRODUCT_SORTS = [
    "new",
    "price_asc",
    "price_desc",
    "name_asc",
    "name_desc",
    "updated_asc",
    "updated_desc",
] as const;

export type ProductSort = (typeof PRODUCT_SORTS)[number];

/** Derived product kind: no option groups = simple, otherwise variable. */
export const PRODUCT_TYPES = ["simple", "variable"] as const;

export type ProductType = (typeof PRODUCT_TYPES)[number];

/** What the nutrition values refer to. */
export const NUTRITION_BASES = [
    "PER_100G",
    "PER_100ML",
    "PER_SERVING",
    "PER_PACK",
] as const;

export type NutritionBasis = (typeof NUTRITION_BASES)[number];

export interface ListProductsInput extends PageQueryDto {
    q?: string;
    status?: ProductStatus;
    type?: ProductType;
    excludeIds?: bigint[];
    storeId?: bigint;
    /** One category (sub-categories included). Kept for older clients; merged with `categoryIds`. */
    categoryId?: bigint;
    /** Any of these categories (sub-categories included). */
    categoryIds?: bigint[];
    /** Any category of these category groups (sub-categories included). AND-ed with `categoryIds`. */
    groupIds?: bigint[];
    /** One brand. Kept for older clients; merged with `brandIds`. */
    brandId?: bigint;
    /** Any of these brands. */
    brandIds?: bigint[];
    sort?: ProductSort;
    deleted?: boolean;
    sku?: string;
    barcode?: string;
}

export interface CheckProductSlugInput {
    title?: string;
    slug?: string;
    excludeId?: bigint;
}

/** One `Name: Value` pair (key features, custom attributes). */
export interface NameValueInput {
    name: string;
    value: string;
}

/**
 * Language-neutral nutrition settings, stored on the product.
 * The table itself is per language (see {@link NutritionTableDto}).
 */
export interface NutritionMetaInput {
    basis: NutritionBasis;
    servingSize?: string;
    servingsPerPack?: number;
}

/** Table header cell. `children` = sub-columns (max 2 header levels). */
export interface NutritionColumnInput {
    label: string;
    children?: NutritionColumnInput[];
}

/**
 * Table row. `values` has one cell per leaf column (or is empty for a
 * group heading row). `children` = sub-rows (max 3 levels).
 */
export interface NutritionRowInput {
    label: string;
    values: string[];
    children?: NutritionRowInput[];
}

/**
 * Free-form nutrition table, drawn like a word-processor table. Every
 * language must use the same column / row structure; only the text differs.
 */
export interface NutritionTableInput {
    columns: NutritionColumnInput[];
    rows: NutritionRowInput[];
}

/**
 * Product Translation (one per language). Every text a shopper reads lives
 * here. All fields except `lang` are optional so a draft can be saved
 * half-filled; publishing requires a default-language `title`.
 */
export interface TranslationInput {
    lang: string;
    title?: string;
    shortDescription?: string;
    description?: string;
    keyFeatures?: NameValueInput[];
    ingredients?: string;
    storageInstructions?: string;
    manufacturerAddress?: string;
    allergens?: string[];
    attributes?: NameValueInput[];
    nutrition?: NutritionTableInput;
    /** Additional search terms, any script. Stored so search text can be rebuilt. */
    keywords?: string[];
    /** Search engine listing. Falls back to title / short description. */
    seoTitle?: string;
    seoDescription?: string;
}

export interface BarcodeInput {
    code: string;
    type?: BarcodeType;
    isPrimary?: boolean;
}

/** Per-variant image override for one of its option values (image-type option groups). */
export interface VariantOptionImageInput {
    optionValueId: bigint;
    mediaId: bigint;
}

export interface VariantInput {
    sku?: string;
    /**
     * Maximum retail price, tax inclusive. Stores can never sell above it.
     * Required on every variant, drafts included.
     */
    mrp: number;
    /** Sold by (KG, PIECE, GRAM, DOZEN ...). */
    unit?: UnitType;
    /** `{unit}` per pack, e.g. 5 (KG). */
    unitValue?: number;
    /** Shipping weight; only sent when it differs ("by checking"). */
    weightGrams?: number;
    /** One option value per product option, e.g. [Size-L, Flavour-Chocolate]. */
    optionValueIds?: bigint[];
    optionImages?: VariantOptionImageInput[];
    barcodes?: BarcodeInput[];
    /** Variant gallery (images / videos). */
    mediaIds?: bigint[];
    /**
     * Audio clip for this variant (e.g. a different bell sound per model),
     * picked from the media library. `null` removes it; omitted = keep.
     */
    audioMediaId?: bigint | null;
    position?: number;
    isActive?: boolean;
}

export interface UpdateVariantInput {
    mrp?: number;
    unit?: UnitType;
    unitValue?: number;
    weightGrams?: number;
    isActive?: boolean;
    position?: number;
    barcodes?: BarcodeInput[];
    mediaIds?: bigint[];
    /**
     * Audio clip for this variant (e.g. a different bell sound per model),
     * picked from the media library. `null` removes it; omitted = keep.
     */
    audioMediaId?: bigint | null;
}

export interface UpdateProductVariantInput extends VariantInput {
    id?: bigint;
}

/**
 * Product Base (language-neutral fields).
 *
 * The thumbnail is not sent: it is always the first gallery item, which must
 * be an image.
 */
export interface ProductBaseInput {
    brandId?: bigint | null;
    /** Audio clip (e.g. a calling-bell sound) picked from the media library. */
    audioMediaId?: bigint | null;
    dietType?: DietType;
    hsnCode?: string;
    gstRate?: number;
    /** ISO 3166-1 alpha-2, e.g. IN. */
    countryOfOrigin?: string;
    shelfLifeDays?: number;
    isPerishable?: boolean;
    manufacturerName?: string;
    nutrition?: NutritionMetaInput;
    /** Product gallery (images / videos). The first item must be an image and becomes the thumbnail. */
    mediaIds?: bigint[];
}

/**
 * Create Product.
 *
 * DRAFT (default): only one of title / category / a variant is required.
 * PUBLISHED: every publishing rule must pass (see the publish endpoint).
 */
export interface CreateProductInput extends ProductBaseInput {
    slug?: string;
    categoryId?: bigint;
    translations?: TranslationInput[];
    /** Ordered option groups, e.g. [Size, Flavour]. Empty = simple product. */
    optionGroupIds?: bigint[];
    variants?: VariantInput[];
    status?: ProductStatus;
}

export interface UpdateProductInput extends Partial<Omit<CreateProductInput, "variants" | "status">> {
    variants?: UpdateProductVariantInput[];
    status?: ProductStatus;
    expectedUpdatedAt?: Date;
}

/**
 * Single status endpoint (`PATCH admin/products/:id/status`). Any status can
 * move to any other; PUBLISHED runs every publish rule. Sending the current
 * status is a no-op (`changed: false`), so retries are safe.
 */
export interface UpdateProductStatusInput {
    status: ProductStatus;
    expectedUpdatedAt?: Date;
}

/** Reconfigure product option groups and explicitly map every existing variant to the new values. */
export interface ProductVariantOptionAssignmentInput {
    id: bigint;
    optionValueIds: bigint[];
}

export interface UpdateProductOptionsInput {
    optionGroupIds: bigint[];
    variants: ProductVariantOptionAssignmentInput[];
}

export interface QuickEditVariantInput {
    id: bigint;
    mrp?: number;
    isActive?: boolean;
}

/** Inline edit from the product list. Only the fields sent change. */
export interface QuickEditProductInput {
    title?: string;
    status?: ProductStatus;
    categoryId?: bigint;
    brandId?: bigint | null;
    variants?: QuickEditVariantInput[];
    expectedUpdatedAt?: Date;
}

export interface BulkProductIdsInput {
    ids: bigint[];
}

export interface BulkProductStatusInput extends BulkProductIdsInput {
    status: ProductStatus;
}

export interface BulkAssignProductsInput extends BulkProductIdsInput {
    categoryId?: bigint;
    brandId?: bigint | null;
}

export interface CheckSkuInput {
    sku: string;
    excludeVariantId?: bigint;
}

export interface GenerateSkuItemInput {
    optionValueIds?: bigint[];
}

/** Generates one unique SKU per variant row ("generate all SKUs" button). */
export interface GenerateSkusInput {
    title?: string;
    slug?: string;
    variants: GenerateSkuItemInput[];
    reserved?: string[];
    excludeProductId?: bigint;
}

export interface ManufacturerSuggestionInput {
    q?: string;
    brandId?: bigint;
    lang?: string;
    limit?: number;
}
