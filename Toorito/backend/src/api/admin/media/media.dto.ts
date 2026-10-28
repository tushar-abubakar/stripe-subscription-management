import {
    MediaFilterInput,
    MediaListQueryInput,
    MediaSummaryQueryInput,
} from "@modules/media/media.types";
import { IsBigIntId } from "@common/decorators/bigint-id.decorator";
import { PageQueryDto } from "@common/dto/page-query.dto";
import { IsLocaleMap } from "@common/validators/is-locale-map.validator";
import {
    MEDIA_GROUP_BY,
    MEDIA_USAGE_TYPES,
    MediaGroupBy,
    MediaUsageType,
} from "@modules/media/media.config";
import {
    ApiProperty,
    ApiPropertyOptional,
    IntersectionType,
} from "@nestjs/swagger";
import { MediaPurpose, MediaStatus, MediaType } from "@prisma-client/enums";
import { Transform, Type } from "class-transformer";
import {
    IsBoolean,
    IsEnum,
    IsIn,
    IsInt,
    IsObject,
    IsOptional,
    IsString,
    MaxLength,
    Min,
    ValidateIf,
} from "class-validator";

/** multipart/form-data sends objects as JSON strings. */
const parseJson = ({ value }: { value: unknown }) => {
    if (typeof value !== "string") return value;
    try {
        return JSON.parse(value);
    } catch {
        return value;
    }
};
const toBool = ({ value }: { value: unknown }) =>
    value === true || value === "true"
        ? true
        : value === false || value === "false"
          ? false
          : value;

const LOCALE_EX = '{"en":"Red apple","hi":"लाल सेब"}';

class LocalizedTextDto {
    @ApiPropertyOptional({
        type: "object",
        additionalProperties: { type: "string" },
        example: { en: "Red apple", hi: "लाल सेब" },
        description: `Per-language title. In multipart, send as JSON string, e.g. ${LOCALE_EX}. Max length per language: config media.text.titleMaxLen`,
    })
    @Transform(parseJson)
    @IsObject()
    @IsLocaleMap()
    title: Record<string, string>;

    @ApiPropertyOptional({
        type: "object",
        additionalProperties: { type: "string" },
        example: { en: "Red apple on white background" },
        description:
            "Per-language alt text. Max length per language: config media.text.altMaxLen",
    })
    @IsOptional()
    @Transform(parseJson)
    @IsObject()
    @ValidateIf((_, value) => value != null && Object.keys(value).length > 0)
    @IsLocaleMap()
    alt?: Record<string, string>;
}

/** Filters shared by GET /admin/media and GET /admin/media/summary (or /store/media…). */
export class MediaFilterDto implements MediaFilterInput {
    @ApiPropertyOptional({
        description: "Search title / alt (ANY language) and original file name",
    })
    @IsOptional()
    @IsString()
    @MaxLength(100)
    q?: string;

    @ApiPropertyOptional({
        enum: MediaPurpose,
        description: "Group (product, category, brand, avatar, kyc, ...)",
    })
    @IsOptional()
    @IsEnum(MediaPurpose)
    purpose?: MediaPurpose;

    @ApiPropertyOptional({ enum: MediaStatus })
    @IsOptional()
    @IsEnum(MediaStatus)
    status?: MediaStatus;

    @ApiPropertyOptional({ enum: MediaType })
    @IsOptional()
    @IsEnum(MediaType)
    type?: MediaType;

    @ApiPropertyOptional({
        description:
            "Private media is hidden unless true. Non-admins only get their own private files.",
    })
    @IsOptional()
    @Transform(toBool)
    @IsBoolean()
    includePrivate?: boolean;

    @ApiPropertyOptional({
        enum: ["PUBLIC", "PRIVATE"],
        description: "PRIVATE also requires includePrivate=true",
    })
    @IsOptional()
    @IsIn(["PUBLIC", "PRIVATE"])
    visibility?: "PUBLIC" | "PRIVATE";

    @ApiPropertyOptional({
        description: "true = referenced nowhere, false = referenced somewhere",
    })
    @IsOptional()
    @Transform(toBool)
    @IsBoolean()
    unused?: boolean;

    @ApiPropertyOptional({
        enum: MEDIA_USAGE_TYPES,
        description: "Only media referenced by this resource type",
    })
    @IsOptional()
    @IsIn(MEDIA_USAGE_TYPES)
    usedIn?: MediaUsageType;

    @ApiPropertyOptional({
        type: String,
        example: "42",
        description: "Uploader user id (admin only for other users)",
    })
    @IsOptional()
    @IsBigIntId()
    uploadedById?: bigint;
}

export class MediaListQueryDto extends IntersectionType(
    PageQueryDto,
    MediaFilterDto,
) implements MediaListQueryInput {
    @ApiPropertyOptional({
        enum: ["newest", "oldest", "size_desc"],
        default: "newest",
    })
    @IsOptional()
    @IsIn(["newest", "oldest", "size_desc"])
    sort?: "newest" | "oldest" | "size_desc";

    @ApiPropertyOptional({
        description:
            "Keyset cursor from a previous response (newest/oldest only); overrides page",
    })
    @IsOptional()
    @IsString()
    cursor?: string;
}

export class MediaSummaryQueryDto extends MediaFilterDto implements MediaSummaryQueryInput {
    @ApiPropertyOptional({ enum: MEDIA_GROUP_BY, default: "purpose" })
    @IsOptional()
    @IsIn(MEDIA_GROUP_BY)
    groupBy?: MediaGroupBy;
}

export class UpdateMediaDto extends LocalizedTextDto {}

/** One-shot multipart upload (POST /account/media). */
export class UploadMediaDto extends LocalizedTextDto {
    @ApiProperty({ enum: MediaPurpose })
    @IsEnum(MediaPurpose)
    purpose: MediaPurpose;
}

/** Step 1 of direct upload (POST /account/media/uploads). */
export class InitUploadDto extends UploadMediaDto {
    @ApiProperty({ example: "apple.png" })
    @IsString()
    @MaxLength(255)
    fileName: string;

    @ApiProperty({ example: "image/png" })
    @IsString()
    @MaxLength(100)
    mimeType: string;

    @ApiProperty({ description: "Exact byte size", example: 240000 })
    @Type(() => Number)
    @IsInt()
    @Min(1)
    size: number;
}
