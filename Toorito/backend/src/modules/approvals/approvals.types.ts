import { PageQueryDto } from "@common/dto/page-query.dto";
import { ApprovalRequestStatus, ApprovalType } from "@prisma-client/enums";

/** Plain input types of the approvals services (no decorators; the HTTP DTOs in src/api implement them). */


export interface ApprovalListInput extends PageQueryDto {
    type?: ApprovalType;
    status?: ApprovalRequestStatus;
}

export interface AdminApprovalListInput extends ApprovalListInput {
    storeId?: number;
    level?: "ADMIN" | "STORE" | "ALL";
}

export interface StoreApprovalListInput extends ApprovalListInput {
    box?: "inbox" | "outbox";
}

/** Approve / reject. Returns accept extra options. */
export interface DecisionInput {
    note?: string;
    restock?: boolean;
    applyMedia?: boolean;
    refundAmount?: number;
}

export interface ReturnItemInput {
    orderItemId: number;
    quantity: number;
    reason: string;
}

/** Customer asks to return (refund) or exchange (replacement) delivered items. */
export interface CreateReturnInput {
    type: "RETURN" | "EXCHANGE";
    items: ReturnItemInput[];
    note?: string;
    mediaIds?: number[];
}
