import { PageQueryDto } from "@common/dto/page-query.dto";
import { IsLocaleMap } from "@common/validators/is-locale-map.validator";
import {
    ApiProperty,
    ApiPropertyOptional,
    OmitType,
    PartialType,
} from "@nestjs/swagger";
import { SduiGroupKind, SduiScreenKind } from "@prisma-client/enums";
import { Transform, Type } from "class-transformer";
import {
    ArrayMaxSize,
    IsArray,
    IsBoolean,
    IsDate,
    IsEnum,
    IsIn,
    IsInt,
    IsObject,
    IsOptional,
    IsString,
    Matches,
    MaxLength,
    Min,
    MinLength,
    ValidateIf,
    ValidateNested,
} from "class-validator";

const QueryBool = () =>
    Transform(({ value }) =>
        value === "true" || value === true
            ? true
            : value === "false" || value === false
              ? false
              : value,
    );
const I18N = (example: Record<string, string>, description?: string) =>
    ApiProperty({
        type: "object",
        additionalProperties: { type: "string" },
        example,
        description: description ?? "Text per language",
    });
const I18N_OPT = (example: Record<string, string>, description?: string) =>
    ApiPropertyOptional({
        type: "object",
        additionalProperties: { type: "string" },
        example,
        nullable: true,
        description: description ?? "Text per language",
    });

// ─── screens ─────────────────────────────────────────────────────────────

export class ScreenListQuery extends PageQueryDto {
    @ApiPropertyOptional({
        example: "home",
        description: "Key or title (any language)",
    })
    @IsOptional()
    @IsString()
    @MaxLength(80)
    q?: string;

    @ApiPropertyOptional({ enum: SduiScreenKind })
    @IsOptional()
    @IsEnum(SduiScreenKind)
    kind?: SduiScreenKind;

    @ApiPropertyOptional({
        enum: [
            "live",
            "never_published",
            "unpublished_changes",
            "scheduled",
            "inactive",
        ],
    })
    @IsOptional()
    @IsIn([
        "live",
        "never_published",
        "unpublished_changes",
        "scheduled",
        "inactive",
    ])
    state?:
        | "live"
        | "never_published"
        | "unpublished_changes"
        | "scheduled"
        | "inactive";
}

export class CreateScreenDto {
    @ApiProperty({
        example: "page:monsoon-sale",
        description:
            '^[a-z0-9][a-z0-9_:-]{1,79}$ — PAGE keys start with "page:"; templates e.g. "group_landing:fresh". Can\'t change later.',
    })
    @Matches(/^[a-z0-9][a-z0-9_:-]{1,79}$/)
    key: string;

    @ApiProperty({
        enum: ["SCREEN", "PAGE", "TEMPLATE"],
        example: "PAGE",
        description: 'SHELL exists once ("shell")',
    })
    @IsIn(["SCREEN", "PAGE", "TEMPLATE"])
    kind: SduiScreenKind;

    @I18N(
        { en: "Monsoon sale", bn: "বর্ষার সেল" },
        "Screen title in the app bar",
    )
    @IsLocaleMap()
    title: Record<string, string>;

    @I18N_OPT({ en: "July campaign landing page" }, "Admin description")
    @IsOptional()
    @IsLocaleMap()
    description?: Record<string, string>;

    @ApiPropertyOptional({
        example: 2,
        description: "Start from this screen's draft…",
    })
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    copyFromScreenId?: number;

    @ApiPropertyOptional({
        example: 7,
        description: "…or from one of its versions",
    })
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    copyFromVersion?: number;
}

export class UpdateScreenDto {
    @I18N_OPT({ en: "Home", bn: "হোম" })
    @IsOptional()
    @IsLocaleMap()
    title?: Record<string, string>;

    @I18N_OPT({ en: "First tab" })
    @IsOptional()
    @ValidateIf((_o, v) => v !== null)
    @IsLocaleMap()
    description?: Record<string, string> | null;

    @ApiPropertyOptional({
        example: false,
        description:
            "Inactive screens return 404 to the app (not for system screens)",
    })
    @IsOptional()
    @IsBoolean()
    isActive?: boolean;
}

export class SaveDraftDto {
    @ApiProperty({
        type: "object",
        additionalProperties: true,
        description: "The whole layout (contract: GET admin/sdui/components)",
    })
    @IsObject()
    layout: Record<string, unknown>;

    @ApiProperty({
        example: 14,
        description:
            "draftRevision you loaded / last saved (mismatch → 409 DRAFT_CONFLICT)",
    })
    @IsInt()
    @Min(0)
    revision: number;
}

export class ValidateDto {
    @ApiPropertyOptional({
        type: "object",
        additionalProperties: true,
        description: "Check this (unsaved) layout instead of the saved draft",
    })
    @IsOptional()
    @IsObject()
    layout?: Record<string, unknown>;
}

export class PublishDto {
    @ApiPropertyOptional({
        example: "Monsoon banners + late night sale",
        maxLength: 500,
        description: "Internal release note",
    })
    @IsOptional()
    @IsString()
    @MaxLength(500)
    note?: string;

    @ApiPropertyOptional({
        example: "2026-11-01T00:00:00+06:00",
        description: "Future time → SCHEDULED, goes live by itself",
    })
    @IsOptional()
    @Type(() => Date)
    @IsDate()
    publishAt?: Date;

    @ApiPropertyOptional({
        example: true,
        default: true,
        description: "false = variant for targeting / A-B rules only",
    })
    @IsOptional()
    @IsBoolean()
    makeLive?: boolean;

    @ApiPropertyOptional({
        example: 14,
        description:
            "Refuse (409 DRAFT_CHANGED) if the draft changed after review",
    })
    @IsOptional()
    @IsInt()
    @Min(0)
    revision?: number;
}

export class VersionListQuery extends PageQueryDto {}

export class DiffQuery {
    @ApiPropertyOptional({
        example: "live",
        default: "live",
        description: '"live", "draft" or a version number',
    })
    @IsOptional()
    @Matches(/^(live|draft|\d{1,6})$/)
    against?: string;
}

export class RuleDto {
    @ApiProperty({
        example: "Dhaka · new users · 50%",
        description: "Internal label",
    })
    @IsString()
    @MinLength(2)
    @MaxLength(120)
    name: string;

    @ApiProperty({
        example: 9,
        description: "Published version of this screen to serve",
    })
    @IsInt()
    @Min(1)
    version: number;

    @ApiPropertyOptional({
        example: 10,
        default: 100,
        description: "Lower runs first",
    })
    @IsOptional()
    @IsInt()
    @Min(0)
    priority?: number;

    @ApiPropertyOptional({
        type: "object",
        additionalProperties: true,
        example: {
            cities: ["Dhaka"],
            segments: ["NEW_CUSTOMER"],
            abBucket: { from: 0, to: 49, salt: "home-nov" },
        },
        description:
            "All must match: storeIds, cities, platforms, appVersion {min,max}, loggedIn, segments, abBucket {from,to,salt}",
    })
    @IsOptional()
    @IsObject()
    conditions?: Record<string, unknown>;

    @ApiPropertyOptional({
        example: "2026-11-01T00:00:00+06:00",
        nullable: true,
    })
    @IsOptional()
    @Type(() => Date)
    @IsDate()
    startsAt?: Date | null;

    @ApiPropertyOptional({
        example: "2026-11-08T00:00:00+06:00",
        nullable: true,
    })
    @IsOptional()
    @Type(() => Date)
    @IsDate()
    endsAt?: Date | null;

    @ApiPropertyOptional({ example: true, default: true })
    @IsOptional()
    @IsBoolean()
    isActive?: boolean;
}

export class UpdateRuleDto extends PartialType(RuleDto) {}

// ─── saved sections ──────────────────────────────────────────────────────

export class SectionListQuery extends PageQueryDto {
    @ApiPropertyOptional({
        example: "bestseller",
        description: "Key or name (any language)",
    })
    @IsOptional()
    @IsString()
    @MaxLength(80)
    q?: string;

    @ApiPropertyOptional({
        example: "product_rail",
        description: "Section type",
    })
    @IsOptional()
    @IsString()
    @MaxLength(40)
    type?: string;

    @ApiPropertyOptional({ example: true })
    @IsOptional()
    @QueryBool()
    @IsBoolean()
    isActive?: boolean;
}

export class CreateSectionDto {
    @ApiProperty({
        example: "bestsellers",
        description:
            '^[a-z0-9][a-z0-9_-]{1,79}$ — placed with { "type": "section_ref", "ref": "bestsellers" }',
    })
    @Matches(/^[a-z0-9][a-z0-9_-]{1,79}$/)
    key: string;

    @I18N({ en: "Bestsellers rail", bn: "বেস্টসেলার" }, "Library label")
    @IsLocaleMap()
    name: Record<string, string>;

    @ApiProperty({
        type: "object",
        additionalProperties: true,
        description:
            "One section (any body type, containers included); same shape as layout.sections[]",
    })
    @IsObject()
    node: Record<string, unknown>;

    @ApiPropertyOptional({ example: true, default: true })
    @IsOptional()
    @IsBoolean()
    isActive?: boolean;
}

export class UpdateSectionDto extends PartialType(
    OmitType(CreateSectionDto, ["key"] as const),
) {
    @ApiProperty({
        example: 3,
        description: "Revision you loaded (409 SECTION_CONFLICT on mismatch)",
    })
    @IsInt()
    @Min(0)
    revision: number;
}

// ─── custom groups ───────────────────────────────────────────────────────

export class GroupListQuery extends PageQueryDto {
    @ApiPropertyOptional({
        example: "fresh",
        description: "Key or title (any language)",
    })
    @IsOptional()
    @IsString()
    @MaxLength(80)
    q?: string;

    @ApiPropertyOptional({ enum: SduiGroupKind })
    @IsOptional()
    @IsEnum(SduiGroupKind)
    kind?: SduiGroupKind;

    @ApiPropertyOptional({ example: true })
    @IsOptional()
    @QueryBool()
    @IsBoolean()
    isActive?: boolean;
}

export class GroupItemDto {
    @ApiProperty({ enum: ["product", "category", "brand"], example: "product" })
    @IsIn(["product", "category", "brand"])
    type: "product" | "category" | "brand";

    @ApiProperty({ example: "12" })
    @Matches(/^[0-9]+$/)
    id: string;
}

export class CreateGroupDto {
    @ApiProperty({
        example: "fresh",
        description:
            '^[a-z0-9][a-z0-9_-]{1,79}$ — used by { "type": "open_group", "key": "fresh" } and sources',
    })
    @Matches(/^[a-z0-9][a-z0-9_-]{1,79}$/)
    key: string;

    @I18N({ en: "Fresh items", bn: "তাজা পণ্য" })
    @IsLocaleMap()
    title: Record<string, string>;

    @I18N_OPT({ en: "Picked this morning", bn: "আজ সকালে তোলা" })
    @IsOptional()
    @ValidateIf((_o, v) => v !== null)
    @IsLocaleMap()
    subtitle?: Record<string, string> | null;

    @ApiPropertyOptional({
        type: "object",
        additionalProperties: true,
        example: {
            cover: { mediaId: "9301" },
            icon: { mediaId: "9302" },
            banner: { mediaId: "9303" },
        },
        description: "Upload with POST /account/media, purpose BANNER",
        nullable: true,
    })
    @IsOptional()
    @ValidateIf((_o, v) => v !== null)
    @IsObject()
    media?: Record<string, unknown> | null;

    @ApiProperty({ enum: SduiGroupKind, example: "MANUAL" })
    @IsEnum(SduiGroupKind)
    kind: SduiGroupKind;

    @ApiPropertyOptional({
        type: () => [GroupItemDto],
        description:
            "MANUAL: items in display order (max 200; products, categories, brands)",
    })
    @IsOptional()
    @IsArray()
    @ArrayMaxSize(200)
    @ValidateNested({ each: true })
    @Type(() => GroupItemDto)
    items?: GroupItemDto[];

    @ApiPropertyOptional({
        type: "object",
        additionalProperties: true,
        nullable: true,
        example: { newWithinDays: 7, inStockOnly: true, sort: "new" },
        description:
            "RULE: categoryIds, brandIds, newWithinDays, flashOnly, inStockOnly, minDiscountPct, maxPrice, sort",
    })
    @IsOptional()
    @ValidateIf((_o, v) => v !== null)
    @IsObject()
    rule?: Record<string, unknown> | null;

    @ApiPropertyOptional({
        type: "object",
        additionalProperties: true,
        nullable: true,
        example: { days: ["THU", "FRI", "SAT"], from: "23:00", to: "05:00" },
        description: "When the group is on (hidden outside)",
    })
    @IsOptional()
    @ValidateIf((_o, v) => v !== null)
    @IsObject()
    schedule?: Record<string, unknown> | null;

    @ApiPropertyOptional({
        example: 4,
        nullable: true,
        description:
            "TEMPLATE / PAGE screen opened on tap (null = group_landing)",
    })
    @IsOptional()
    @ValidateIf((_o, v) => v !== null)
    @Type(() => Number)
    @IsInt()
    @Min(1)
    landingScreenId?: number | null;

    @ApiPropertyOptional({
        type: "object",
        additionalProperties: true,
        nullable: true,
        example: {
            header: "banner_large",
            filters: ["category", "price"],
            sort: ["bestselling", "price_asc"],
            layout: { columns: 3, cardVariant: "card_compact" },
        },
        description: "Per-group settings of the landing page",
    })
    @IsOptional()
    @ValidateIf((_o, v) => v !== null)
    @IsObject()
    landing?: Record<string, unknown> | null;

    @ApiPropertyOptional({ example: true, default: true })
    @IsOptional()
    @IsBoolean()
    isActive?: boolean;
}

export class UpdateGroupDto extends PartialType(
    OmitType(CreateGroupDto, ["key", "kind"] as const),
) {}

// ─── preview ─────────────────────────────────────────────────────────────

export class PreviewEntityDto {
    @ApiProperty({ enum: ["group", "category", "brand"], example: "group" })
    @IsIn(["group", "category", "brand"])
    type: "group" | "category" | "brand";

    @ApiProperty({
        example: "late-night",
        description: "Group key, category id or brand id",
    })
    @IsString()
    @MaxLength(80)
    ref: string;
}

export class PreviewDto {
    @ApiPropertyOptional({
        type: "object",
        additionalProperties: true,
        description: "Unsaved canvas layout (default: the saved draft)",
    })
    @IsOptional()
    @IsObject()
    layout?: Record<string, unknown>;

    @ApiProperty({
        example: 1,
        description: "Store whose products / stock fill the sections",
    })
    @Type(() => Number)
    @IsInt()
    @Min(1)
    storeId: number;

    @ApiPropertyOptional({
        example: 4,
        description: "See it as this customer (buy again, segment)",
    })
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    userId?: number;

    @ApiPropertyOptional({ enum: ["GUEST", "NEW_CUSTOMER", "REPEAT_CUSTOMER"] })
    @IsOptional()
    @IsIn(["GUEST", "NEW_CUSTOMER", "REPEAT_CUSTOMER"])
    segment?: "GUEST" | "NEW_CUSTOMER" | "REPEAT_CUSTOMER";

    @ApiPropertyOptional({
        example: "bn",
        description: "Default: Accept-Language",
    })
    @IsOptional()
    @Matches(/^[a-z]{2}(-[A-Za-z]{2})?$/)
    lang?: string;

    @ApiPropertyOptional({
        enum: ["android", "ios", "web"],
        default: "android",
    })
    @IsOptional()
    @IsIn(["android", "ios", "web"])
    platform?: "android" | "ios" | "web";

    @ApiPropertyOptional({
        example: "1.4.0",
        default: "99.0.0",
        description: "Default: newest (everything shows)",
    })
    @IsOptional()
    @Matches(/^\d{1,3}\.\d{1,3}\.\d{1,4}$/)
    appVersion?: string;

    @ApiPropertyOptional({
        example: "2026-10-24T23:30:00+06:00",
        description:
            "See it at this time (late-night sections, schedules, campaign windows)",
    })
    @IsOptional()
    @Type(() => Date)
    @IsDate()
    at?: Date;

    @ApiPropertyOptional({
        type: () => PreviewEntityDto,
        description: "TEMPLATE screens: the item it opens for",
    })
    @IsOptional()
    @ValidateNested()
    @Type(() => PreviewEntityDto)
    entity?: PreviewEntityDto;
}

export class DataPreviewDto {
    @ApiProperty({
        type: "object",
        additionalProperties: true,
        example: { type: "group", key: "late-night", limit: 6 },
        description: "A section's `source`",
    })
    @IsObject()
    source: Record<string, unknown>;

    @ApiProperty({ example: 1 })
    @Type(() => Number)
    @IsInt()
    @Min(1)
    storeId: number;

    @ApiPropertyOptional({ example: 4, description: "For buy again" })
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    userId?: number;

    @ApiPropertyOptional({ example: "bn" })
    @IsOptional()
    @Matches(/^[a-z]{2}(-[A-Za-z]{2})?$/)
    lang?: string;

    @ApiPropertyOptional({
        type: () => PreviewEntityDto,
        description: "`entity` source: the opened item",
    })
    @IsOptional()
    @ValidateNested()
    @Type(() => PreviewEntityDto)
    entity?: PreviewEntityDto;

    @ApiPropertyOptional({ example: "eyJvIjoxMn0" })
    @IsOptional()
    @IsString()
    @MaxLength(200)
    cursor?: string;
}
