import { ApiProperty } from "@nestjs/swagger";
import { ProductStatus, UserRole } from "@prisma-client/enums";

export class AppInfoResponseDto {
    @ApiProperty({ example: "QC Backend" })
    name!: string;

    @ApiProperty({ example: "Asia/Dhaka" })
    timezone!: string;
}

export class LocalizationResponseDto {
    @ApiProperty({ example: "en" })
    defaultLanguage!: string;

    @ApiProperty({
        type: [String],
        example: ["en", "hi", "pa"],
    })
    languages!: string[];

    @ApiProperty({
        type: [Boolean],
        example: [false, false, false],
    })
    rtl!: boolean[];
}

export class CurrencyResponseDto {
    @ApiProperty({ example: "BDT" })
    code!: string;

    @ApiProperty({ example: "৳" })
    symbol!: string;

    @ApiProperty({ example: 2 })
    fractionDigits!: number;
}

export class PhoneResponseDto {
    @ApiProperty({
        type: [String],
        example: ["BD"],
    })
    allowedCountries!: string[];
}

export class ImageVariantResponseDto {
    @ApiProperty({ example: 1000 })
    width!: number;

    @ApiProperty({ example: 1000 })
    height!: number;

    @ApiProperty({
        enum: ["contain", "cover", "inside"],
        example: "contain",
    })
    fit!: "contain" | "cover" | "inside";
}

export class ImageProfileResponseDto {
    @ApiProperty({ type: ImageVariantResponseDto })
    master!: ImageVariantResponseDto;

    @ApiProperty({ type: ImageVariantResponseDto })
    thumbnail!: ImageVariantResponseDto;
}

export class PublicMediaResponseDto {
    @ApiProperty({
        type: "object",
        additionalProperties: true,
        description:
            "Image profiles grouped by media purpose and profile name.",
        example: {
            PRODUCT: {
                image: {
                    master: {
                        width: 1000,
                        height: 1000,
                        fit: "contain",
                    },
                    thumbnail: {
                        width: 512,
                        height: 512,
                        fit: "contain",
                    },
                },
            },
        },
    })
    imageProfiles!: Record<string, unknown>;

    @ApiProperty({ example: 10485760 })
    maxImageBytes!: number;

    @ApiProperty({ example: 104857600 })
    maxVideoBytes!: number;

    @ApiProperty({ example: 52428800 })
    maxAudioBytes!: number;

    @ApiProperty({ example: 15728640 })
    maxDocumentBytes!: number;
}

export class ProductRequirementsResponseDto {
    @ApiProperty({ example: 1 })
    minimumVariants!: number;

    @ApiProperty({ example: true })
    categoryRequired!: boolean;
}

export class PublicAppConfigResponseDto {
    @ApiProperty({ type: AppInfoResponseDto })
    app!: AppInfoResponseDto;

    @ApiProperty({ type: LocalizationResponseDto })
    localization!: LocalizationResponseDto;

    @ApiProperty({ type: CurrencyResponseDto })
    currency!: CurrencyResponseDto;

    @ApiProperty({ type: PhoneResponseDto })
    phone!: PhoneResponseDto;

    @ApiProperty({ type: PublicMediaResponseDto })
    media!: PublicMediaResponseDto;

    @ApiProperty({ type: ProductRequirementsResponseDto })
    product!: ProductRequirementsResponseDto;
}

export class CacheTtlResponseDto {
    @ApiProperty({ example: 600 })
    catalog!: number;

    @ApiProperty({ example: 300 })
    product!: number;

    @ApiProperty({ example: 300 })
    permissions!: number;

    @ApiProperty({ example: 60 })
    account!: number;

    @ApiProperty({ example: 300 })
    storeGeo!: number;
}

export class CacheLeaseResponseDto {
    @ApiProperty({ example: 5000 })
    leaseMs!: number;

    @ApiProperty({ example: 50 })
    pollMs!: number;

    @ApiProperty({ example: 60 })
    maxPolls!: number;
}

export class CacheResponseDto {
    @ApiProperty({ type: CacheTtlResponseDto })
    ttlSec!: CacheTtlResponseDto;

    @ApiProperty({ type: CacheLeaseResponseDto })
    lease!: CacheLeaseResponseDto;
}

export class AdminMediaResponseDto extends PublicMediaResponseDto {
    @ApiProperty({ example: "LOCAL" })
    provider!: string;

    @ApiProperty({ example: "" })
    bucket!: string;

    @ApiProperty({ example: 900 })
    uploadUrlTtlSec!: number;

    @ApiProperty({
        type: "object",
        additionalProperties: { type: "number" },
        example: {
            titleMaxLen: 191,
            altMaxLen: 255,
        },
    })
    text!: Record<string, number>;
}

export class AdminCatalogResponseDto {
    @ApiProperty({
        enum: ProductStatus,
        isArray: true,
        example: ["DRAFT", "PUBLISHED", "ARCHIVED"],
    })
    productStatuses!: ProductStatus[];

    @ApiProperty({ example: true })
    supportsProductRestore!: boolean;

    @ApiProperty({ example: true })
    supportsOptionTypes!: boolean;

    @ApiProperty({ example: 1 })
    minimumCategories!: number;
}

export class AdminAppConfigResponseDto {
    @ApiProperty({ type: AppInfoResponseDto })
    app!: AppInfoResponseDto;

    @ApiProperty({ type: LocalizationResponseDto })
    localization!: LocalizationResponseDto;

    @ApiProperty({ type: CurrencyResponseDto })
    currency!: CurrencyResponseDto;

    @ApiProperty({ type: PhoneResponseDto })
    phone!: PhoneResponseDto;

    @ApiProperty({ type: AdminMediaResponseDto })
    media!: AdminMediaResponseDto;

    @ApiProperty({ type: ProductRequirementsResponseDto })
    product!: ProductRequirementsResponseDto;

    @ApiProperty({
        enum: UserRole,
        isArray: true,
        example: [
            "CUSTOMER",
            "DELIVERY_PARTNER",
            "STORE_STAFF",
            "STORE_MANAGER",
            "ADMIN",
            "SUPER_ADMIN",
        ],
    })
    roles!: UserRole[];

    @ApiProperty({ enum: ["ADMIN"], example: "ADMIN" })
    audience!: string;

    @ApiProperty({ type: CacheResponseDto })
    cache!: CacheResponseDto;

    @ApiProperty({ type: AdminCatalogResponseDto })
    catalog!: AdminCatalogResponseDto;
}

export class StorePermissionsResponseDto {
    @ApiProperty({ example: false })
    canManageGlobalProducts!: boolean;

    @ApiProperty({ example: true })
    canManageInventory!: boolean;

    @ApiProperty({ example: true })
    canManageStorePricing!: boolean;
}

export class StoreAppConfigResponseDto extends PublicAppConfigResponseDto {
    @ApiProperty({ enum: ["STORE"], example: "STORE" })
    audience!: string;

    @ApiProperty({ type: StorePermissionsResponseDto })
    permissions!: StorePermissionsResponseDto;
}

export class DeliveryLocalizationResponseDto {
    @ApiProperty({ example: "en" })
    defaultLanguage!: string;

    @ApiProperty({
        type: [String],
        example: ["en", "hi", "pa"],
    })
    languages!: string[];
}

export class DeliveryTrackingResponseDto {
    @ApiProperty({ example: true })
    enabled!: boolean;
}

export class DeliveryAppConfigResponseDto {
    @ApiProperty({ type: AppInfoResponseDto })
    app!: AppInfoResponseDto;

    @ApiProperty({ type: DeliveryLocalizationResponseDto })
    localization!: DeliveryLocalizationResponseDto;

    @ApiProperty({
        enum: ["DELIVERY_PARTNER"],
        example: "DELIVERY_PARTNER",
    })
    audience!: string;

    @ApiProperty({ type: DeliveryTrackingResponseDto })
    tracking!: DeliveryTrackingResponseDto;
}

export class ConfigErrorResponseDto {
    @ApiProperty({ example: 401 })
    statusCode!: number;

    @ApiProperty({ example: "Unauthorized" })
    message!: string;
}