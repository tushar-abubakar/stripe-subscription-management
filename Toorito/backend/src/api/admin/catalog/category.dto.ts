import {
    CATEGORY_SORTS,
    CategorySort,
    CategoryInput,
    CategoryStatusInput,
    CategoryBulkStatusInput,
    CategoryListInput,
    CheckCategorySlugInput,
} from "@modules/catalog/category/category.types";
import {
    IsBigIntArray,
    IsBigIntId,
} from "@common/decorators/bigint-id.decorator";
import { Slug } from "@common/decorators/slug.decorator";
import { PageQueryDto } from "@common/dto/page-query.dto";
import { IsLocaleMap } from "@common/validators/is-locale-map.validator";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { CategoryStatus } from "@prisma-client/enums";
import { Transform } from "class-transformer";
import {
    ArrayNotEmpty,
    IsBoolean,
    IsEnum,
    IsIn,
    IsInt,
    IsOptional,
    IsString,
    MaxLength,
} from "class-validator";

/** Max categories in one bulk status request. */
export const CATEGORY_BULK_MAX = 100;

/** Create / update payload for a category (admin). Ids are bigint. */
export class CategoryDto implements CategoryInput {
    @ApiPropertyOptional({ type: String, example: "1" })
    @IsOptional()
    @IsBigIntId()
    parentId?: bigint;

    @IsOptional()
    @Slug()
    slug?: string;

    @IsLocaleMap()
    name: Record<string, string>;

    @IsOptional()
    @IsLocaleMap()
    description?: Record<string, string>;

    @ApiPropertyOptional({ enum: CategoryStatus, example: "ACTIVE" })
    @IsOptional()
    @IsEnum(CategoryStatus)
    status?: CategoryStatus;

    @IsBigIntId()
    iconId: bigint;

    @ApiPropertyOptional({ type: String, example: "1" })
    @IsOptional()
    @IsBigIntId()
    bannerId?: bigint;

    @IsOptional()
    @IsInt()
    position?: number;
}

/**
 * Status change for one category.
 *
 * `moveProductsTo` / `detachChildren` only apply when leaving ACTIVE:
 *  - moveProductsTo: reassign products + store listings to this ACTIVE
 *    category first, instead of failing with "in use".
 *  - detachChildren: child categories not part of the change are turned
 *    into root categories (parentId removed) instead of blocking.
 */
export class CategoryStatusDto implements CategoryStatusInput {
    @ApiProperty({ enum: CategoryStatus, example: "INACTIVE" })
    @IsEnum(CategoryStatus)
    status!: CategoryStatus;

    @ApiPropertyOptional({ type: String, example: "7" })
    @IsOptional()
    @IsBigIntId()
    moveProductsTo?: bigint;

    @ApiPropertyOptional({ type: Boolean, default: false })
    @IsOptional()
    @IsBoolean()
    detachChildren?: boolean;
}

/** Bulk status change. All-or-nothing; `dryRun` previews blockers without saving. */
export class CategoryBulkStatusDto extends CategoryStatusDto implements CategoryBulkStatusInput {
    @ApiProperty({ type: [String], example: ["12", "15"] })
    @ArrayNotEmpty()
    @IsBigIntArray({ max: CATEGORY_BULK_MAX })
    ids!: bigint[];

    @ApiPropertyOptional({ type: Boolean, default: false })
    @IsOptional()
    @IsBoolean()
    dryRun?: boolean;
}

/** Admin category list filters. */
export class CategoryListQuery extends PageQueryDto implements CategoryListInput {
    @IsOptional()
    @IsString()
    @MaxLength(100)
    @Transform(({ value }) =>
        typeof value === "string" ? value.trim() : value,
    )
    q?: string;

    @ApiPropertyOptional({ enum: CategoryStatus, example: "ACTIVE" })
    @IsOptional()
    @IsEnum(CategoryStatus)
    status?: CategoryStatus;

    @ApiPropertyOptional({
        type: [String],
        example: ["1", "2"],
        description:
            "Exclude categories that are descendants of this category ID",
    })
    @IsOptional()
    @IsBigIntArray({ max: 20 })
    excludeSubtreeOf?: bigint[];

    @ApiPropertyOptional({
        type: [String],
        example: ["1", "2"],
        description: "Exclude categories with these IDs",
    })
    @IsOptional()
    @IsBigIntArray({ max: 100 })
    excludeIds?: bigint[];

    @ApiPropertyOptional({ enum: CATEGORY_SORTS, default: "position_asc" })
    @IsOptional()
    @IsIn(CATEGORY_SORTS)
    sort?: CategorySort;

    @ApiPropertyOptional({
        type: [String],
        example: ["3", "4"],
        description:
            "Only categories in any of these category groups (`?groupIds=3,4` or `?groupIds=3&groupIds=4`)",
    })
    @IsOptional()
    @IsBigIntArray({ max: 50 })
    groupIds?: bigint[];
}

export class CheckCategorySlugQuery implements CheckCategorySlugInput {
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
        description: "Self category ID exclude from the check during editing",
    })
    @IsOptional()
    @IsBigIntId()
    excludeId?: bigint;
}
