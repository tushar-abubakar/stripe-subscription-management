import {
    KycDocInput,
    KycListInput,
    AdminKycListInput,
} from "@modules/kyc/kyc.types";
import { PageQueryDto } from "@common/dto/page-query.dto";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { KycDocType, KycStatus, UserRole } from "@prisma-client/enums";
import { Type } from "class-transformer";
import {
    IsBoolean,
    IsDateString,
    IsEnum,
    IsIn,
    IsInt,
    IsNotEmpty,
    IsOptional,
    IsString,
    MaxLength,
    Min,
    MinLength,
    ValidateIf,
} from "class-validator";

/** Types a member / manager can upload (legacy AADHAAR / PAN / VOTER_ID are refused). */
export const UPLOADABLE_KYC_TYPES = [
    KycDocType.NID,
    KycDocType.PASSPORT,
    KycDocType.DRIVING_LICENSE,
    KycDocType.SELFIE,
    KycDocType.VEHICLE_RC,
    KycDocType.OTHER,
] as const;

/**
 * One KYC document (files uploaded first through /account/media with purpose=KYC).
 * It is saved as a DRAFT: preview / replace / delete freely, then submit.
 */
export class KycDocDto implements KycDocInput {
    @ApiProperty({
        enum: UPLOADABLE_KYC_TYPES,
        example: KycDocType.NID,
        description:
            "NID / PASSPORT / DRIVING_LICENSE prove identity; SELFIE; VEHICLE_RC (riders). OTHER = any extra document — several allowed, `title` required. " +
            "Uploading a type you already have replaces it while it isn't approved; an approved one stays until an admin removes it.",
    })
    @IsIn(UPLOADABLE_KYC_TYPES)
    type: KycDocType;

    @ApiPropertyOptional({ example: "Police clearance certificate", maxLength: 120, description: "Required for OTHER" })
    @ValidateIf((d: KycDocDto) => d.type === KycDocType.OTHER || d.title !== undefined)
    @IsString()
    @MinLength(3)
    @MaxLength(120)
    title?: string;

    @ApiPropertyOptional({ example: "1990123456789", maxLength: 40, description: "NID (10 / 13 / 17 digits), passport or licence number. Stored masked (last 4 only)" })
    @IsOptional()
    @IsString()
    @MaxLength(40)
    documentNumber?: string;

    @ApiProperty({ example: 9101, description: "MediaFile id (purpose KYC) of the front side / photo" })
    @Type(() => Number)
    @IsInt()
    @Min(1)
    frontMediaId: number;

    @ApiPropertyOptional({ example: 9102, description: "MediaFile id of the back side (NID, driving licence)" })
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    backMediaId?: number;

    @ApiPropertyOptional({ example: "2031-05-01", format: "date" })
    @IsOptional()
    @IsDateString()
    expiresAt?: string;
}

/** Ask an admin to remove an old document (it can't be deleted directly). */
export class KycRemovalDto {
    @ApiProperty({ example: "Old NID photo is blurred, uploaded a new one", maxLength: 1000 })
    @IsString()
    @IsNotEmpty()
    @MaxLength(1000)
    note: string;
}

/** Store manager's review: forwarded to the admin with a recommendation. */
export class KycForwardDto {
    @ApiProperty({ enum: ["APPROVE", "REJECT"], example: "APPROVE" })
    @IsIn(["APPROVE", "REJECT"])
    recommendation: "APPROVE" | "REJECT";

    @ApiPropertyOptional({ example: "Checked original in person at the store", maxLength: 1000 })
    @IsOptional()
    @IsString()
    @MaxLength(1000)
    note?: string;
}

/** Admin decision on one document. */
export class KycReviewDto {
    @ApiProperty({ example: true })
    @IsBoolean()
    approve: boolean;

    @ApiPropertyOptional({ example: "Photo does not match selfie", maxLength: 255, description: "Required when rejecting" })
    @ValidateIf((dto: KycReviewDto) => dto.approve === false)
    @IsString()
    @IsNotEmpty()
    @MaxLength(255)
    reason?: string;
}

export class KycListQuery extends PageQueryDto implements KycListInput {
    @ApiPropertyOptional({ enum: KycStatus })
    @IsOptional()
    @IsEnum(KycStatus)
    status?: KycStatus;

    @ApiPropertyOptional({ enum: [UserRole.STORE_STAFF, UserRole.DELIVERY_PARTNER] })
    @IsOptional()
    @IsIn([UserRole.STORE_STAFF, UserRole.DELIVERY_PARTNER])
    role?: UserRole;

    @ApiPropertyOptional({ type: Number, example: 120 })
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    userId?: number;
}

export class AdminKycListQuery extends KycListQuery implements AdminKycListInput {
    @ApiPropertyOptional({ type: Number, example: 7 })
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    storeId?: number;
}

/** Manager submits a member's KYC (and the sign-up). */
export class KycSubmitDto {
    @ApiPropertyOptional({ example: "Evening shift rider", maxLength: 1000, description: "Note for the admin" })
    @IsOptional()
    @IsString()
    @MaxLength(1000)
    note?: string;
}
