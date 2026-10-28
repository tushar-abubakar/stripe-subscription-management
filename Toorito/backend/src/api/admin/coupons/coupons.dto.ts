import {
    CreateCouponInput,
    UpdateCouponInput,
} from "@modules/orders/orders.types";
import { IsLocaleMap } from "@common/validators/is-locale-map.validator";
import { ApiProperty, ApiPropertyOptional, PartialType } from "@nestjs/swagger";
import { DiscountType } from "@prisma-client/enums";
import { Type } from "class-transformer";
import {
    IsBoolean,
    IsDateString,
    IsEnum,
    IsInt,
    IsNumber,
    IsOptional,
    Matches,
    Min,
    ValidateIf,
} from "class-validator";

export class CreateCouponDto implements CreateCouponInput {
    @ApiProperty({ example: "WELCOME10", minLength: 3, maxLength: 40 })
    @Matches(/^[A-Za-z0-9_-]{3,40}$/)
    code: string;

    @ApiPropertyOptional({ type: Object, example: { en: "Welcome offer" } })
    @IsOptional()
    @IsLocaleMap()
    @ValidateIf((_, value) => value != null && Object.keys(value).length > 0)
    description?: Record<string, string>;

    @ApiProperty({ enum: DiscountType })
    @IsEnum(DiscountType)
    discountType: DiscountType;

    @ApiProperty({ type: Number, minimum: 0, example: 10 })
    @IsNumber({ maxDecimalPlaces: 2 })
    @Min(0)
    discountValue: number;

    @ApiPropertyOptional({ type: Number, minimum: 0 })
    @IsOptional()
    @IsNumber({ maxDecimalPlaces: 2 })
    @Min(0)
    maxDiscount?: number;

    @ApiPropertyOptional({ type: Number, minimum: 0 })
    @IsOptional()
    @IsNumber({ maxDecimalPlaces: 2 })
    @Min(0)
    minOrderValue?: number;

    @ApiPropertyOptional({ type: Number, minimum: 1 })
    @IsOptional()
    @IsInt()
    @Min(1)
    usageLimit?: number;

    @ApiPropertyOptional({ type: Number, minimum: 1 })
    @IsOptional()
    @IsInt()
    @Min(1)
    perUserLimit?: number;

    @ApiPropertyOptional({ type: Boolean })
    @IsOptional()
    @IsBoolean()
    firstOrderOnly?: boolean;

    @ApiPropertyOptional({ type: Number, minimum: 1 })
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    storeId?: number;

    @ApiPropertyOptional({ type: String, format: "date-time" })
    @IsOptional()
    @IsDateString()
    startsAt?: string;

    @ApiPropertyOptional({ type: String, format: "date-time" })
    @IsOptional()
    @IsDateString()
    endsAt?: string;

    @ApiPropertyOptional({ type: Boolean })
    @IsOptional()
    @IsBoolean()
    isActive?: boolean;
}

/** Partial update payload for PATCH /admin/coupons/:id. */
export class UpdateCouponDto
    extends PartialType(CreateCouponDto)
    implements UpdateCouponInput {}

