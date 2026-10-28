/**
 * Creating approval requests. Plain functions over a Prisma client /
 * transaction so any module (inventory, users, kyc, returns) can open a
 * request without depending on ApprovalsService (which depends on them to
 * apply decisions).
 */
import { AuthUser } from "@common/types/auth.type";
import { ConflictException } from "@nestjs/common";
import { Prisma } from "@prisma-client/client";
import {
    ApprovalLevel,
    ApprovalRequestStatus,
    ApprovalType,
} from "@prisma-client/enums";

type Db = Prisma.TransactionClient;

/** Who decides each request type. */
export const APPROVAL_LEVEL: Record<ApprovalType, ApprovalLevel> = {
    MEMBER_ONBOARDING: ApprovalLevel.ADMIN,
    KYC_VERIFICATION: ApprovalLevel.ADMIN,
    KYC_DOC_REMOVAL: ApprovalLevel.ADMIN,
    BARCODE_ADD: ApprovalLevel.ADMIN,
    GRN_EDIT: ApprovalLevel.ADMIN,
    CATALOG_CHANGE: ApprovalLevel.ADMIN,
    ORDER_RETURN: ApprovalLevel.STORE,
    ORDER_EXCHANGE: ApprovalLevel.STORE,
};

export interface NewApproval {
    type: ApprovalType;
    storeId: bigint | null;
    targetType: "User" | "KycDocument" | "StoreProduct" | "GoodsReceipt" | "Order" | "Product" | "ProductVariant";
    targetId: bigint;
    note?: string | null;
    payload?: Record<string, unknown>;
    snapshot?: Record<string, unknown> | null;
}

/** Types where every store may have its own pending request for the same target (e.g. two stores asking for a catalogue fix). */
const PER_STORE_TYPES: ApprovalType[] = [ApprovalType.CATALOG_CHANGE];

/** Pending request for a target, if any (per store for PER_STORE_TYPES). */
export function pendingFor(db: Db, type: ApprovalType, targetType: string, targetId: bigint, storeId?: bigint | null) {
    return db.approvalRequest.findFirst({
        where: {
            type,
            targetType,
            targetId,
            status: ApprovalRequestStatus.PENDING,
            ...(PER_STORE_TYPES.includes(type) && { storeId: storeId ?? null }),
        },
    });
}

/**
 * Opens a request. Refuses a second PENDING request for the same
 * (type, target) with 409 APPROVAL_ALREADY_PENDING.
 * BigInt values inside payload / snapshot are stored as strings.
 */
export async function openApproval(db: Db, actor: AuthUser, input: NewApproval) {
    const existing = await pendingFor(db, input.type, input.targetType, input.targetId, input.storeId);
    if (existing)
        throw new ConflictException({
            message: "A request for this item is already waiting for a decision",
            code: "APPROVAL_ALREADY_PENDING",
            approvalId: existing.id,
        });

    return db.approvalRequest.create({
        data: {
            type: input.type,
            level: APPROVAL_LEVEL[input.type],
            storeId: input.storeId,
            targetType: input.targetType,
            targetId: input.targetId,
            requestedById: actor.id,
            requestedByRole: actor.role,
            note: input.note ?? null,
            payload: toJson(input.payload ?? {}),
            snapshot: input.snapshot ? toJson(input.snapshot) : undefined,
        },
    });
}

/** JSON-safe copy (bigint → string, Decimal → number, Date → ISO). */
export function toJson(value: unknown): Prisma.InputJsonValue {
    return JSON.parse(
        JSON.stringify(value, (_k, v) =>
            typeof v === "bigint"
                ? v.toString()
                : v && typeof v === "object" && v.constructor?.name === "Decimal"
                  ? Number(v)
                  : v,
        ),
    ) as Prisma.InputJsonValue;
}

/** Signature of a domain handler run when a request is approved / rejected (inside the decision transaction). */
export type ApprovalHandler = (
    tx: Db,
    request: Awaited<ReturnType<Db["approvalRequest"]["findUniqueOrThrow"]>>,
    decision: { approve: boolean; actor: AuthUser; note?: string; options?: Record<string, unknown> },
) => Promise<{ result?: Record<string, unknown>; afterCommit?: () => Promise<unknown> } | void>;
