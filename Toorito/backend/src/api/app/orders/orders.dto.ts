import {
    CheckoutInput,
    PackInput,
    StoreOrderListInput,
    AdminOrderListInput,
} from "@modules/orders/orders.types";
import { PageQueryDto } from "@common/dto/page-query.dto";
import { OrderStatus, PaymentMethod } from "@prisma-client/enums";
import { Transform, Type } from "class-transformer";
import {
    IsArray,
    IsBoolean,
    IsDateString,
    IsEnum,
    IsIn,
    IsInt,
    IsNumber,
    IsOptional,
    IsString,
    Max,
    MaxLength,
    Min,
} from "class-validator";

/** Statuses a store may move an order to. */
export const STORE_SETTABLE_STATUSES = [
    OrderStatus.ACCEPTED,
    OrderStatus.REJECTED,
    OrderStatus.PACKING,
    OrderStatus.READY_FOR_PICKUP,
    OrderStatus.CANCELLED,
] as const;

export class CheckoutDto implements CheckoutInput {
    @Type(() => Number)
    @IsInt()
    @Min(1)
    addressId: number;

    @IsEnum(PaymentMethod)
    paymentMethod: PaymentMethod;

    @IsOptional()
    @IsBoolean()
    useWallet?: boolean;

    @IsOptional()
    @IsString()
    @MaxLength(500)
    instructions?: string;

    @IsOptional()
    @IsNumber({ maxDecimalPlaces: 2 })
    @Min(0)
    @Max(500)
    tip?: number;

    /** Client generated key; a repeated key returns the original order. */
    @IsOptional()
    @IsString()
    @MaxLength(64)
    idempotencyKey?: string;
}

export class CancelDto {
    @IsOptional()
    @IsString()
    @MaxLength(255)
    reason?: string;
}

export class RateDto {
    @IsInt()
    @Min(1)
    @Max(5)
    rating: number;

    @IsOptional()
    @IsInt()
    @Min(1)
    @Max(5)
    deliveryRating?: number;

    @IsOptional()
    @IsString()
    @MaxLength(500)
    note?: string;
}

export class OrderStatusChangeDto {
    @IsIn(STORE_SETTABLE_STATUSES)
    status: OrderStatus;

    @IsOptional()
    @IsString()
    @MaxLength(255)
    reason?: string;
}

/** @deprecated Use OrderStatusChangeDto. */
export class StoreStatusDto extends OrderStatusChangeDto {}

export class PackDto implements PackInput {
    /** Provide either a scanned barcode OR an orderItemId (manual pick). */
    @IsOptional()
    @IsString()
    @MaxLength(64)
    barcode?: string;

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    orderItemId?: number;

    @IsOptional()
    @IsInt()
    @Min(1)
    quantity?: number;
}

/** Store order list: `?status=PLACED,ACCEPTED&page=1`. */
export class StoreOrderListQuery extends PageQueryDto implements StoreOrderListInput {
    /** Comma separated statuses; every item must be a valid status. */
    @IsOptional()
    @Transform(({ value }) =>
        typeof value === "string"
            ? value
                  .split(",")
                  .map((item) => item.trim())
                  .filter(Boolean)
            : value,
    )
    @IsArray()
    @IsEnum(OrderStatus, { each: true })
    status?: OrderStatus[];
}

/** Admin order list: optional store and status filters. */
export class AdminOrderListQuery extends PageQueryDto implements AdminOrderListInput {
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    storeId?: number;

    @IsOptional()
    @IsEnum(OrderStatus)
    status?: OrderStatus;

    @IsOptional()
    @IsString()
    @MaxLength(100)
    q?: string;

    @IsOptional()
    @IsDateString()
    from?: string;

    @IsOptional()
    @IsDateString()
    to?: string;

    @IsOptional()
    @IsIn(["newest", "oldest", "total_desc", "total_asc"])
    sort?: "newest" | "oldest" | "total_desc" | "total_asc";
}
