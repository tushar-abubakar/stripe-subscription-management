import { PageQueryDto } from "@common/dto/page-query.dto";
import { DiscountType, OrderStatus, PaymentMethod } from "@prisma-client/enums";

/** Plain input types of the orders services (no decorators; the HTTP DTOs in src/api implement them). */


export interface CheckoutInput {
    addressId: number;
    paymentMethod: PaymentMethod;
    useWallet?: boolean;
    instructions?: string;
    tip?: number;
    /** Client generated key; a repeated key returns the original order. */
    idempotencyKey?: string;
}

export interface PackInput {
    /** Provide either a scanned barcode OR an orderItemId (manual pick). */
    barcode?: string;
    orderItemId?: number;
    quantity?: number;
}

/** Store order list: `?status=PLACED,ACCEPTED&page=1`. */
export interface StoreOrderListInput extends PageQueryDto {
    /** Comma separated statuses; every item must be a valid status. */
    status?: OrderStatus[];
}

/** Admin order list: optional store and status filters. */
export interface AdminOrderListInput extends PageQueryDto {
    storeId?: number;
    status?: OrderStatus;
    q?: string;
    from?: string;
    to?: string;
    sort?: "newest" | "oldest" | "total_desc" | "total_asc";
}

/** Create payload of a coupon (admin). Money values are in the store currency. */
export interface CreateCouponInput {
    code: string;
    description?: Record<string, string>;
    discountType: DiscountType;
    discountValue: number;
    maxDiscount?: number;
    minOrderValue?: number;
    usageLimit?: number;
    perUserLimit?: number;
    firstOrderOnly?: boolean;
    storeId?: number;
    startsAt?: string;
    endsAt?: string;
    isActive?: boolean;
}

/** Partial update payload of a coupon. */
export type UpdateCouponInput = Partial<CreateCouponInput>;
