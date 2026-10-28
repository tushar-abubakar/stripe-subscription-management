import {
    BRAND_SORTS,
    BrandSort,
    BrandInput,
    BrandStatusInput,
    BrandBulkStatusInput,
    BrandListInput,
    CheckBrandSlugInput,
} from "@modules/catalog/brand/brand.types";
import {
    IsBigIntArray,
    IsBigIntId,
} from "@common/decorators/bigint-id.decorator";
import { Slug } from "@common/decorators/slug.decorator";
import { PageQueryDto } from "@common/dto/page-query.dto";
import { IsLocaleMap } from "@common/validators/is-locale-map.validator";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { BrandStatus } from "@prisma-client/enums";
import { Transform } from "class-transformer";
import {
    ArrayNotEmpty,
    IsBoolean,
    IsEnum,
    IsIn,
    IsOptional,
    IsString,
    MaxLength,
} from "class-validator";

/** Max brands in one bulk status request. */
export const BRAND_BULK_MAX = 100;

/** Create / replace a brand (PUT semantics, same as categories). */
export class BrandDto implements BrandInput {
    @IsOptional()
    @Slug()
    slug?: string;

    @IsLocaleMap()
    name: Record<string, string>;

    @IsOptional()
    @IsLocaleMap()
    description?: Record<string, string>;

    @ApiPropertyOptional({
        enum: BrandStatus,
        description:
            "Defaults to ACTIVE on create; omitted on update keeps the current status.",
    })
    @IsOptional()
    @IsEnum(BrandStatus)
    status?: BrandStatus;

    @IsBigIntId()
    logoId: bigint;

    @ApiPropertyOptional({ type: String, example: "1" })
    @IsOptional()
    @IsBigIntId()
    bannerId?: bigint;
}

/**
 * Status change for one brand.
 *
 * `detachProducts` only applies when leaving ACTIVE: products using the
 * brand get their brand removed (`brandId = null`) instead of failing
 * with "in use".
 */
export class BrandStatusDto implements BrandStatusInput {
    @ApiProperty({ enum: BrandStatus })
    @IsEnum(BrandStatus)
    status!: BrandStatus;

    @ApiPropertyOptional({ type: Boolean, default: false })
    @IsOptional()
    @IsBoolean()
    detachProducts?: boolean;
}

/** Bulk status change. All-or-nothing; `dryRun` previews blockers without saving. */
export class BrandBulkStatusDto extends BrandStatusDto implements BrandBulkStatusInput {
    @ApiProperty({ type: [String], example: ["7", "9"] })
    @ArrayNotEmpty()
    @IsBigIntArray({ max: BRAND_BULK_MAX })
    ids!: bigint[];

    @ApiPropertyOptional({ type: Boolean, default: false })
    @IsOptional()
    @IsBoolean()
    dryRun?: boolean;
}

export class BrandListQuery extends PageQueryDto implements BrandListInput {
    @IsOptional()
    @IsString()
    @MaxLength(100)
    @Transform(({ value }) =>
        typeof value === "string" ? value.trim() : value,
    )
    q?: string;

    @ApiPropertyOptional({ enum: BrandStatus, description: "Filter by status" })
    @IsOptional()
    @IsEnum(BrandStatus)
    status?: BrandStatus;

    @ApiPropertyOptional({
        type: [String],
        example: ["1", "2"],
        description: "Exclude brand with these IDs",
    })
    @IsOptional()
    @IsBigIntArray({ max: 100 })
    excludeIds?: bigint[];

    @ApiPropertyOptional({ enum: BRAND_SORTS, default: "id_desc" })
    @IsOptional()
    @IsIn(BRAND_SORTS)
    sort?: BrandSort;
}

export class CheckBrandSlugQuery implements CheckBrandSlugInput {
    @IsOptional()
    @IsString()
    @MaxLength(200)
    @Transform(({ value }) =>
        typeof value === "string" ? value.trim() : value,
    )
    title?: string;

    @IsOptional()
    @Slug()
    slug?: string;

    @ApiPropertyOptional({
        type: String,
        example: "1",
        description: "Brand id to ignore (edit form)",
    })
    @IsOptional()
    @IsBigIntId()
    excludeId?: bigint;
}
