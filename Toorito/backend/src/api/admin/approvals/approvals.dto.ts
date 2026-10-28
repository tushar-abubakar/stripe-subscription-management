import {
    ApprovalListInput,
    AdminApprovalListInput,
    StoreApprovalListInput,
    DecisionInput,
    ReturnItemInput,
    CreateReturnInput,
} from "@modules/approvals/approvals.types";
import { PageQueryDto } from "@common/dto/page-query.dto";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { ApprovalRequestStatus, ApprovalType } from "@prisma-client/enums";
import { Type } from "class-transformer";
import {
    ArrayMaxSize,
    ArrayMinSize,
    ArrayUnique,
    IsArray,
    IsBoolean,
    IsEnum,
    IsIn,
    IsInt,
    IsNumber,
    IsOptional,
    IsString,
    MaxLength,
    Min,
    MinLength,
    ValidateNested,
} from "class-validator";

export class ApprovalListQuery extends PageQueryDto implements ApprovalListInput {
    @ApiPropertyOptional({ enum: ApprovalType })
    @IsOptional()
    @IsEnum(ApprovalType)
    type?: ApprovalType;

    @ApiPropertyOptional({ enum: ApprovalRequestStatus, default: "PENDING" })
    @IsOptional()
    @IsEnum(ApprovalRequestStatus)
    status?: ApprovalRequestStatus;
}

export class AdminApprovalListQuery extends ApprovalListQuery implements AdminApprovalListInput {
    @ApiPropertyOptional({ type: Number, example: 7 })
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    storeId?: number;

    @ApiPropertyOptional({ enum: ["ADMIN", "STORE", "ALL"], default: "ADMIN", description: "STORE = store-level requests (returns), for oversight" })
    @IsOptional()
    @IsIn(["ADMIN", "STORE", "ALL"])
    level?: "ADMIN" | "STORE" | "ALL";
}

export class StoreApprovalListQuery extends ApprovalListQuery implements StoreApprovalListInput {
    @ApiPropertyOptional({
        enum: ["inbox", "outbox"],
        default: "inbox",
        description: "inbox = waiting for YOUR decision (returns / exchanges); outbox = what your store sent to the admin",
    })
    @IsOptional()
    @IsIn(["inbox", "outbox"])
    box?: "inbox" | "outbox";
}

/** Approve / reject. Returns accept extra options. */
export class DecisionDto implements DecisionInput {
    @ApiPropertyOptional({ example: "Verified with the supplier invoice", maxLength: 1000, description: "Required when rejecting" })
    @IsOptional()
    @IsString()
    @MaxLength(1000)
    note?: string;

    @ApiPropertyOptional({ example: true, description: "ORDER_RETURN / ORDER_EXCHANGE: put the returned units back on sale (default true)" })
    @IsOptional()
    @IsBoolean()
    restock?: boolean;

    @ApiPropertyOptional({ example: true, description: "CATALOG_CHANGE: attach the store's suggested images / videos to the product (or variation) gallery" })
    @IsOptional()
    @IsBoolean()
    applyMedia?: boolean;

    @ApiPropertyOptional({ example: 100, description: "ORDER_RETURN: refund less than the full value of the returned units" })
    @IsOptional()
    @IsNumber({ maxDecimalPlaces: 2 })
    @Min(0)
    refundAmount?: number;
}

export class RejectDecisionDto {
    @ApiProperty({ example: "Photo doesn't show any damage", minLength: 3, maxLength: 1000 })
    @IsString()
    @MinLength(3)
    @MaxLength(1000)
    note: string;
}

export class ReturnItemDto implements ReturnItemInput {
    @ApiProperty({ example: 9001, description: "OrderItem id (a product line, not a bundle header)" })
    @Type(() => Number)
    @IsInt()
    orderItemId: number;

    @ApiProperty({ example: 1, minimum: 1 })
    @IsInt()
    @Min(1)
    quantity: number;

    @ApiProperty({ enum: ["DAMAGED", "EXPIRED", "WRONG_ITEM", "MISSING_PARTS", "QUALITY", "OTHER"], example: "DAMAGED" })
    @IsIn(["DAMAGED", "EXPIRED", "WRONG_ITEM", "MISSING_PARTS", "QUALITY", "OTHER"])
    reason: string;
}

/** Customer asks to return (refund) or exchange (replacement) delivered items. */
export class CreateReturnDto implements CreateReturnInput {
    @ApiProperty({ enum: ["RETURN", "EXCHANGE"], example: "RETURN" })
    @IsIn(["RETURN", "EXCHANGE"])
    type: "RETURN" | "EXCHANGE";

    @ApiProperty({ type: () => [ReturnItemDto], minItems: 1, maxItems: 50 })
    @IsArray()
    @ArrayMinSize(1)
    @ArrayMaxSize(50)
    @ValidateNested({ each: true })
    @Type(() => ReturnItemDto)
    items: ReturnItemDto[];

    @ApiPropertyOptional({ example: "Two eggs broken in the tray", maxLength: 1000 })
    @IsOptional()
    @IsString()
    @MaxLength(1000)
    note?: string;

    @ApiPropertyOptional({
        type: [Number],
        example: [9012],
        maxItems: 5,
        description: "Photos (upload with POST /account/media, purpose SUPPORT). Forensic checks run on upload.",
    })
    @IsOptional()
    @IsArray()
    @ArrayMaxSize(5)
    @ArrayUnique()
    @Type(() => Number)
    @IsInt({ each: true })
    mediaIds?: number[];
}
