import {
    OPTION_SORTS,
    OptionSort,
    OptionListInput,
    OptionGroupInput,
    OptionValueInput,
} from "@modules/catalog/option/option.types";
import {
    IsBigIntArray,
    IsBigIntId,
} from "@common/decorators/bigint-id.decorator";
import { PageQueryDto } from "@common/dto/page-query.dto";
import { IsLocaleMap } from "@common/validators/is-locale-map.validator";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { OptionValueType } from "@prisma-client/enums";
import { Transform, Type } from "class-transformer";
import {
    IsArray,
    IsBoolean,
    IsEnum,
    IsIn,
    IsInt,
    IsOptional,
    IsString,
    MaxLength,
    ValidateNested,
} from "class-validator";

export class OptionListQuery extends PageQueryDto implements OptionListInput {
    @ApiPropertyOptional({
        type: String,
        example: "color",
        maxLength: 100,
        description: "Search option group codes, localized names and values",
    })
    @IsOptional()
    @IsString()
    @MaxLength(100)
    @Transform(({ value }) =>
        typeof value === "string" ? value.trim() : value,
    )
    q?: string;

    @ApiPropertyOptional({
        type: [String],
        example: ["15", "20"],
        description: "Exclude option groups with these BigInt IDs",
    })
    @IsOptional()
    @IsBigIntArray({ max: 100 })
    excludeIds?: bigint[];

    @ApiPropertyOptional({
        enum: OPTION_SORTS,
        default: "id_desc",
    })
    @IsOptional()
    @IsIn(OPTION_SORTS)
    sort?: OptionSort;
}

export class OptionGroupDto implements OptionGroupInput {
    @ApiProperty({
        example: { en: "Color", hi: "रंग", pa: "ਰੰਗ" },
        description: "Localized option group names",
        type: "object",
        additionalProperties: { type: "string" },
    })
    @IsLocaleMap()
    name: Record<string, string>;

    @ApiPropertyOptional({
        example: "COLOR",
        maxLength: 50,
        description:
            'Unique option group code. When omitted on create, it is generated from the default-language name (e.g. "Product Color" → "PRODUCT_COLOR"). Ignored on update.',
    })
    @IsOptional()
    @IsString()
    @MaxLength(50)
    @Transform(({ value }) =>
        typeof value === "string" ? value.trim() || undefined : value,
    )
    code?: string;

    @ApiPropertyOptional({
        enum: OptionValueType,
        default: OptionValueType.TEXT,
    })
    @IsOptional()
    @IsEnum(OptionValueType)
    valueType?: OptionValueType;

    @ApiPropertyOptional({
        example: true,
        default: false,
    })
    @IsOptional()
    @IsBoolean()
    isFilterable?: boolean;

    @ApiPropertyOptional({
        type: () => [OptionValueDto],
        description: "Optional initial values to create or upsert",
    })
    @IsOptional()
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => OptionValueDto)
    values?: OptionValueDto[];
}

export class OptionValueDto implements OptionValueInput {
    @ApiPropertyOptional({
        example: "RED",
        maxLength: 50,
        description:
            'Value code, unique within its group. When omitted on create, it is generated from the default-language label (e.g. "Dark Red" → "DARK_RED"). When omitted on update, the existing code is kept.',
    })
    @IsOptional()
    @IsString()
    @MaxLength(50)
    @Transform(({ value }) =>
        typeof value === "string" ? value.trim() || undefined : value,
    )
    code?: string;

    @ApiProperty({
        example: { en: "Red", hi: "लाल", pa: "ਲਾਲ" },
        description: "Localized option value labels",
        type: "object",
        additionalProperties: { type: "string" },
    })
    @IsLocaleMap()
    label: Record<string, string>;

    @ApiPropertyOptional({
        example: "#FF0000",
        nullable: true,
    })
    @IsOptional()
    @IsString()
    swatch?: string;

    @ApiPropertyOptional({
        type: String,
        example: "45",
        description: "Media ID as a decimal string",
    })
    @IsOptional()
    @IsBigIntId()
    imageId?: bigint;

    @ApiPropertyOptional({
        type: Number,
        example: 1,
        minimum: 0,
    })
    @IsOptional()
    @IsInt()
    position?: number;
}
