import {
    BundleItemInput,
    BundleInput,
} from "@modules/catalog/bundles/bundles.types";
import { Slug } from "@common/decorators/slug.decorator";
import { PageQueryDto } from "@common/dto/page-query.dto";
import { IsLocaleMap } from "@common/validators/is-locale-map.validator";
import { OmitType } from "@nestjs/swagger";
import { BundlePricingType } from "@prisma-client/enums";
import { Transform, Type } from "class-transformer";
import {
    ArrayMinSize,
    IsArray,
    IsBoolean,
    IsDateString,
    IsEnum,
    IsInt,
    IsNumber,
    IsOptional,
    IsString,
    Max,
    MaxLength,
    Min,
    ValidateNested,
} from "class-validator";

export class BundleItemDto implements BundleItemInput {
    @Type(() => Number)
    @IsInt()
    variantId: number;

    @IsInt()
    @Min(1)
    @Max(100)
    quantity: number;
}

export class BundleDto implements BundleInput {
    @IsOptional()
    @Slug()
    slug?: string;

    @IsLocaleMap()
    title: Record<string, string>;

    @IsOptional()
    @IsLocaleMap()
    description?: Record<string, string>;

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    thumbnailId?: number;

    @IsEnum(BundlePricingType)
    pricingType: BundlePricingType;

    @IsOptional()
    @IsNumber({ maxDecimalPlaces: 2 })
    @Min(0)
    fixedPrice?: number;

    @IsOptional()
    @IsNumber({ maxDecimalPlaces: 2 })
    @Min(0)
    discountValue?: number;

    @IsOptional()
    @IsInt()
    @Min(1)
    maxQtyPerOrder?: number;

    /**
     * Omitted = global bundle.
     * Only admins can create global bundles.
     */
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    storeId?: number;

    @IsOptional()
    @IsDateString()
    startsAt?: string;

    @IsOptional()
    @IsDateString()
    endsAt?: string;

    @IsOptional()
    @IsBoolean()
    isActive?: boolean;

    @IsArray()
    @ArrayMinSize(2)
    @ValidateNested({ each: true })
    @Type(() => BundleItemDto)
    items: BundleItemDto[];
}

export class AdminBundleListQuery extends PageQueryDto {
    @IsOptional()
    @IsString()
    @MaxLength(100)
    q?: string;

    /** Query-string booleans arrive as "true"/"false" strings. */
    @IsOptional()
    @Transform(({ value }) =>
        value === "true" || value === "1"
            ? true
            : value === "false" || value === "0"
              ? false
              : value,
    )
    @IsBoolean()
    isActive?: boolean;

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    storeId?: number;
}

/** Store managers only see their own store's bundles, so `storeId` is not accepted. */
export class StoreBundleListQuery extends OmitType(AdminBundleListQuery, [
    "storeId",
] as const) {}
