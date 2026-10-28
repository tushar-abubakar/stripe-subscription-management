import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import {
    IsBoolean,
    IsInt,
    IsOptional,
    IsString,
    MaxLength,
    Min,
} from "class-validator";

export class AddItemDto {
    @ApiPropertyOptional({
        type: Number,
        minimum: 1,
        description: "Variant ID; provide this or bundleId",
    })
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    variantId?: number;

    @ApiPropertyOptional({
        type: Number,
        minimum: 1,
        description: "Bundle ID; provide this or variantId",
    })
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    bundleId?: number;

    @ApiProperty({ type: Number, minimum: 1, maximum: 100, example: 2 })
    @Type(() => Number)
    @IsInt()
    @Min(1)
    quantity: number;

    /** Store id from the public store resolver; cart is bound to one store. */
    @ApiProperty({ type: Number, minimum: 1, example: 12 })
    @Type(() => Number)
    @IsInt()
    storeId: number;

    @ApiPropertyOptional({
        type: Boolean,
        description: "Replace the existing cart store if different",
    })
    @IsOptional()
    @IsBoolean()
    replaceStore?: boolean;
}

export class QuantityDto {
    @ApiProperty({
        type: Number,
        minimum: 0,
        description: "Set to 0 to remove the item",
    })
    @Type(() => Number)
    @IsInt()
    @Min(0)
    quantity: number;
}

export class ApplyCouponDto {
    @ApiProperty({ example: "WELCOME10", maxLength: 40 })
    @IsString()
    @MaxLength(40)
    code: string;
}

