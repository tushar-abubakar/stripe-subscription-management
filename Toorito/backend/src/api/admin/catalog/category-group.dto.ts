import {
    IsBigIntArray,
    IsBigIntId,
} from "@common/decorators/bigint-id.decorator";
import { Slug } from "@common/decorators/slug.decorator";
import { PageQueryDto } from "@common/dto/page-query.dto";
import { IsLocaleMap } from "@common/validators/is-locale-map.validator";
import {
    CATEGORY_GROUP_MAX_ITEMS,
    CategoryGroupInput,
    CategoryGroupListInput,
} from "@modules/catalog/category-group/category-group.types";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { CategoryStatus } from "@prisma-client/enums";
import { Transform } from "class-transformer";
import {
    IsArray,
    IsEnum,
    IsInt,
    IsOptional,
    IsString,
    MaxLength,
} from "class-validator";

/** Create / replace payload of a category group (admin). Ids are bigint. */
export class CategoryGroupDto implements CategoryGroupInput {
    @ApiProperty({
        type: "object",
        additionalProperties: { type: "string" },
        example: { en: "Vegetables & Fruits", bn: "সবজি ও ফল" },
        description: "Text per language",
    })
    @IsLocaleMap()
    name: Record<string, string>;

    @ApiPropertyOptional({
        example: "vegetables-fruits",
        description: "Default: from the default-language name (create only)",
    })
    @IsOptional()
    @Slug()
    slug?: string;

    @ApiPropertyOptional({
        type: "object",
        additionalProperties: { type: "string" },
        example: { en: "Fresh produce, delivered daily" },
        nullable: true,
    })
    @IsOptional()
    @IsLocaleMap()
    description?: Record<string, string> | null;

    @ApiPropertyOptional({ enum: CategoryStatus, example: "ACTIVE", default: "ACTIVE" })
    @IsOptional()
    @IsEnum(CategoryStatus)
    status?: CategoryStatus;

    @ApiPropertyOptional({ example: 0, default: 0, description: "Lower shows first" })
    @IsOptional()
    @IsInt()
    position?: number;

    @ApiProperty({
        type: [String],
        example: ["21", "22", "35"],
        description: `Categories in display order (max ${CATEGORY_GROUP_MAX_ITEMS}); replaces the whole list on update`,
    })
    @IsArray()
    @IsBigIntArray({ max: CATEGORY_GROUP_MAX_ITEMS })
    categoryIds: bigint[];
}

export class CategoryGroupStatusDto {
    @ApiProperty({ enum: CategoryStatus, example: "INACTIVE" })
    @IsEnum(CategoryStatus)
    status!: CategoryStatus;
}

/** Admin list filters. */
export class CategoryGroupListQuery extends PageQueryDto implements CategoryGroupListInput {
    @ApiPropertyOptional({ example: "veg", description: "Slug or name (any language)" })
    @IsOptional()
    @IsString()
    @MaxLength(100)
    @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
    q?: string;

    @ApiPropertyOptional({ enum: CategoryStatus })
    @IsOptional()
    @IsEnum(CategoryStatus)
    status?: CategoryStatus;

    @ApiPropertyOptional({ type: String, example: "21", description: "Only groups containing this category" })
    @IsOptional()
    @IsBigIntId()
    categoryId?: bigint;
}
