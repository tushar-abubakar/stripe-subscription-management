/** Swagger docs for the approval inbox and customer returns / exchanges. */
import { causes, errorSchema, IdParam } from "@common/swagger/swagger.util";
import { applyDecorators } from "@nestjs/common";
import {
    ApiBadRequestResponse,
    ApiBody,
    ApiConflictResponse,
    ApiForbiddenResponse,
    ApiNotFoundResponse,
    ApiOkResponse,
    ApiOperation,
} from "@nestjs/swagger";
import {
    CreateReturnDto,
    DecisionDto,
    RejectDecisionDto,
} from "./approvals.dto";

const ID = IdParam("id", "Approval request ID", "301");
const NOT_FOUND = ApiNotFoundResponse({
    description: "Not found, or not visible to you",
    schema: errorSchema(404, "Not Found", "Approval request not found"),
});
const DECIDED = ApiConflictResponse({
    description: causes("Can't decide", [
        "Already approved / rejected / cancelled (code APPROVAL_ALREADY_DECIDED)",
        "Applying the change failed, e.g. stock already sold (GRN_EDIT_STOCK_USED), replacement out of stock (OUT_OF_STOCK)",
    ]),
    schema: errorSchema(409, "Conflict", "This request is already APPROVED", "APPROVAL_ALREADY_DECIDED"),
});

const REQUEST = {
    id: "301",
    type: "BARCODE_ADD",
    level: "ADMIN",
    status: "PENDING",
    storeId: "7",
    targetType: "StoreProduct",
    targetId: "1201",
    requestedById: "2",
    requestedByRole: "STORE_MANAGER",
    note: "Supplier's new pack has a different EAN",
    payload: { variantId: "88", codes: ["8901234567890"], gate: true, requestedStatus: "ACTIVE", publishAt: null },
    snapshot: null,
    result: null,
    reviewedById: null,
    reviewedByRole: null,
    reviewNote: null,
    reviewedAt: null,
    createdAt: "2026-10-22T05:00:00.000Z",
    updatedAt: "2026-10-22T05:00:00.000Z",
    requestedBy: { id: "2", name: "Rahim (Manager)", role: "STORE_MANAGER" },
    reviewedBy: null,
    store: { id: "7", code: "DHK-GUL-01", name: "Gulshan Dark Store" },
};
const PAGE = { items: [REQUEST], total: 1, page: 1, limit: 20 };

const TYPES_TABLE =
    "| type | level | opened by | on approve |\n|---|---|---|---|\n" +
    "| MEMBER_ONBOARDING | ADMIN | manager adds staff / rider | account ACTIVE, pending KYC verified |\n" +
    "| KYC_VERIFICATION | ADMIN | manager forwards a document | document VERIFIED |\n" +
    "| KYC_DOC_REMOVAL | ADMIN | member | document removed (kept for audit) |\n" +
    "| BARCODE_ADD | ADMIN | manager adds unknown barcodes | barcodes created, gated listing gets its requested status |\n" +
    "| GRN_EDIT | ADMIN | manager edits a posted receipt | receipt + stock corrected (ADJUSTMENT movements) |\n" +
    "| ORDER_RETURN | STORE | customer | units back in stock, refund |\n" +
    "| ORDER_EXCHANGE | STORE | customer | units back in stock, replacement issued (FEFO) |";

export const ApiApprovalList = (who: "admin" | "store" | "me") =>
    applyDecorators(
        ApiOperation({
            summary:
                who === "admin" ? "Approval queue (admin)" : who === "store" ? "My store's approvals (inbox / outbox)" : "Requests I opened",
            description:
                (who === "admin"
                    ? "Default: ADMIN-level PENDING requests, newest first. `level=STORE` shows store-level ones (returns) for oversight.\n\n"
                    : who === "store"
                      ? "`box=inbox` (default): returns / exchanges waiting for you. `box=outbox`: what your store sent to the admin, any status.\n\n"
                      : "") + TYPES_TABLE,
        }),
        ApiOkResponse({ description: "Page of requests", schema: { example: PAGE } }),
    );

export const ApiApprovalSummary = () =>
    applyDecorators(
        ApiOperation({ summary: "Pending counts per type", description: "For badges in the panel." }),
        ApiOkResponse({ schema: { example: { admin: { BARCODE_ADD: 3, GRN_EDIT: 1, MEMBER_ONBOARDING: 2 }, store: { ORDER_RETURN: 4 } } } }),
    );

export const ApiApprovalGet = () =>
    applyDecorators(
        ApiOperation({
            summary: "One request with its target",
            description:
                "`target` depends on `targetType`: the user + KYC (forensics only for stores, files for admins), the listing + barcodes, " +
                "the receipt + invoices, or the order + evidence photos with forensic flags (`metadata.flags.edited / aiSuspected / reused`, `riskScore`).",
        }),
        ID,
        ApiOkResponse({ schema: { example: { ...REQUEST, target: { id: "1201", status: "PENDING_APPROVAL", variant: { id: "88", sku: "MILK-1L", barcodes: [] } } } } }),
        NOT_FOUND,
    );

export const ApiApprove = () =>
    applyDecorators(
        ApiOperation({
            summary: "Approve",
            description:
                "Applies the change and closes the request in one transaction. ADMIN-level requests: admins only. STORE-level (returns / exchanges): " +
                "the order's store manager or an admin. Returns accept `restock` (default true; expired / recalled batches are never restocked) and " +
                "`refundAmount` (≤ value of the returned units; default full).",
        }),
        ID,
        ApiBody({
            type: DecisionDto,
            examples: {
                simple: { value: { note: "Matches the supplier invoice" } },
                partialRefund: { summary: "Return with a partial refund", value: { note: "One egg was fine", restock: false, refundAmount: 60 } },
            },
        }),
        ApiOkResponse({ schema: { example: { ...REQUEST, status: "APPROVED", reviewedBy: { id: "1", name: "Admin", role: "ADMIN" }, result: { barcodes: ["8901234567890"], listingStatus: "ACTIVE" } } } }),
        ApiForbiddenResponse({ description: "Not your level / store (code APPROVAL_NOT_YOURS)", schema: errorSchema(403, "Forbidden", "This request is decided by another authority", "APPROVAL_NOT_YOURS") }),
        DECIDED,
        NOT_FOUND,
    );

export const ApiReject = () =>
    applyDecorators(
        ApiOperation({ summary: "Reject", description: "A note is required; the requester is notified with it. Anything the request put on hold is released." }),
        ID,
        ApiBody({ type: RejectDecisionDto, examples: { reject: { value: { note: "Barcode belongs to another product" } } } }),
        ApiOkResponse({ schema: { example: { ...REQUEST, status: "REJECTED", reviewNote: "Barcode belongs to another product" } } }),
        ApiBadRequestResponse({ description: "Note missing", schema: errorSchema(400, "Bad Request", ["note must be longer than or equal to 3 characters"]) }),
        ApiForbiddenResponse({ description: "Not your level / store (code APPROVAL_NOT_YOURS)", schema: errorSchema(403, "Forbidden", "This request is decided by another authority", "APPROVAL_NOT_YOURS") }),
        DECIDED,
        NOT_FOUND,
    );

export const ApiCancelApproval = () =>
    applyDecorators(
        ApiOperation({
            summary: "Withdraw a pending request",
            description: "By the requester (or, for the store's outbox, the store's manager). A gated listing goes back to DRAFT; a receipt in EDIT_PENDING goes back to POSTED.",
        }),
        ID,
        ApiOkResponse({ schema: { example: { ...REQUEST, status: "CANCELLED" } } }),
        DECIDED,
        NOT_FOUND,
    );

const RETURN = {
    id: "410",
    type: "ORDER_RETURN",
    level: "STORE",
    status: "PENDING",
    storeId: "7",
    targetType: "Order",
    targetId: "5001",
    note: "Two eggs broken",
    payload: {
        items: [{ orderItemId: "9001", quantity: 2, reason: "DAMAGED", sku: "EGG-12", unitValue: 12.5 }],
        mediaIds: [9012],
        refundEstimate: { amount: 25, currency: "BDT", symbol: "৳", formatted: "৳25.00" },
    },
    snapshot: { orderNumber: "ORD-20261022-0042", deliveredAt: "2026-10-22T08:10:00.000Z", total: 640 },
    createdAt: "2026-10-22T09:00:00.000Z",
};

export const ApiCreateReturn = () =>
    applyDecorators(
        ApiOperation({
            summary: "Return or exchange delivered items",
            description:
                "Within 48 hours of delivery. Upload photos first (`POST /account/media`, purpose `SUPPORT`); forensic checks run on upload and are shown to the store. " +
                "The store manager approves (refund / replacement) or rejects with a note. One open request per order.",
        }),
        IdParam("id", "Order ID", "5001"),
        ApiBody({
            type: CreateReturnDto,
            examples: {
                return: { value: { type: "RETURN", items: [{ orderItemId: 9001, quantity: 2, reason: "DAMAGED" }], note: "Two eggs broken", mediaIds: [9012] } },
                exchange: { value: { type: "EXCHANGE", items: [{ orderItemId: 9003, quantity: 1, reason: "WRONG_ITEM" }] } },
            },
        }),
        ApiOkResponse({ schema: { example: RETURN } }),
        ApiBadRequestResponse({
            description: causes("Not returnable", [
                "Order not delivered (ORDER_NOT_DELIVERED)",
                "More than 48 h since delivery (RETURN_WINDOW_CLOSED)",
                "Bundle header / unknown line (ITEM_NOT_RETURNABLE)",
                "More than bought minus already returned (RETURN_QTY_EXCEEDED)",
                "Photos not yours / not SUPPORT (RETURN_MEDIA_INVALID)",
            ]),
            schema: errorSchema(400, "Bad Request", "Returns are accepted within 48 hours of delivery", "RETURN_WINDOW_CLOSED"),
        }),
        ApiConflictResponse({ description: "A request for this order is already open (APPROVAL_ALREADY_PENDING)", schema: errorSchema(409, "Conflict", "A return / exchange for this order is already waiting for the store", "APPROVAL_ALREADY_PENDING") }),
        ApiNotFoundResponse({ description: "Not your order", schema: errorSchema(404, "Not Found", "Order not found") }),
    );

export const ApiMyReturns = () =>
    applyDecorators(
        ApiOperation({ summary: "My returns and exchanges", description: "Newest first; `status` PENDING / APPROVED / REJECTED / CANCELLED, `result.refundAmount` once approved." }),
        ApiOkResponse({ schema: { example: { items: [RETURN], total: 1, page: 1, limit: 20 } } }),
    );
