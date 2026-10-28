import { KycDocType } from "@prisma-client/enums";
import { Type } from "class-transformer";
import {
    IsBoolean,
    IsDateString,
    IsEnum,
    IsIn,
    IsInt,
    IsLatitude,
    IsLongitude,
    IsNotEmpty,
    IsNumber,
    IsOptional,
    IsString,
    Length,
    Matches,
    Max,
    MaxLength,
    Min,
    ValidateIf,
} from "class-validator";

/** Statuses a delivery partner reports while on the way. */
export const PARTNER_PROGRESS_STATUSES = [
    "REACHED_STORE",
    "PICKED_UP",
    "REACHED_CUSTOMER",
] as const;

export type PartnerProgressStatus = (typeof PARTNER_PROGRESS_STATUSES)[number];

/** Identity document submission (mandatory before a partner can be approved). */
export class KycDto {
    @IsEnum(KycDocType)
    type: KycDocType;

    @IsOptional()
    @IsString()
    @MaxLength(40)
    documentNumber?: string;

    @Type(() => Number)
    @IsInt()
    @Min(1)
    frontMediaId: number;

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    backMediaId?: number;

    @IsOptional()
    @IsDateString()
    expiresAt?: string;
}

export class OnlineDto {
    @IsBoolean()
    online: boolean;
}

/** Live location ping (REST fallback for the websocket). */
export class LocationDto {
    @Type(() => Number)
    @IsLatitude()
    lat: number;

    @Type(() => Number)
    @IsLongitude()
    lng: number;

    @IsOptional()
    @IsNumber()
    @Min(0)
    @Max(360)
    heading?: number;
}

export class ReasonDto {
    @IsOptional()
    @IsString()
    @MaxLength(255)
    reason?: string;
}

export class DeliveryProgressDto {
    @IsIn(PARTNER_PROGRESS_STATUSES)
    status: PartnerProgressStatus;
}

/** @deprecated Use DeliveryProgressDto. */
export class ProgressDto extends DeliveryProgressDto {}

export class CompleteDeliveryDto {
    /** 4 digit handover code shown to the customer. */
    @IsString()
    @Matches(/^\d{4}$/)
    @Length(4, 4)
    code: string;

    @IsOptional()
    @IsNumber({ maxDecimalPlaces: 2 })
    @Min(0)
    cashCollected?: number;

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    proofMediaId?: number;
}

export class AssignDto {
    @Type(() => Number)
    @IsInt()
    @Min(1)
    partnerId: number;
}

export class ReviewDto {
    @IsBoolean()
    approve: boolean;

    @ValidateIf((dto: ReviewDto) => dto.approve === false)
    @IsString()
    @IsNotEmpty()
    @MaxLength(255)
    reason?: string;
}
