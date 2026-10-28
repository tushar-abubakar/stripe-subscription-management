/**
 * Swagger / OpenAPI documentation for the staff side of support
 * (customer complaints): admin queue and store-manager queue.
 */
import { applyDecorators } from "@nestjs/common";
import {
    ApiBadRequestResponse,
    ApiBearerAuth,
    ApiBody,
    ApiForbiddenResponse,
    ApiHeader,
    ApiNotFoundResponse,
    ApiOkResponse,
    ApiOperation,
    ApiParam,
    ApiTags,
    ApiUnauthorizedResponse,
} from "@nestjs/swagger";
import {
    EscalateTicketDto,
    ResolveTicketDto,
    StaffMessageDto,
    UpdateTicketDto,
} from "./support.dto";

function errorSchema(statusCode: number, error: string, message: string | string[], code?: string) {
    return {
        type: "object",
        properties: {
            statusCode: { type: "number", example: statusCode },
            message: { oneOf: [{ type: "string" }, { type: "array", items: { type: "string" } }], example: message },
            error: { type: "string", example: error },
            ...(code && { code: { type: "string", example: code } }),
        },
    };
}

const money = (amount: number) => ({ amount, currency: "BDT", symbol: "৳", formatted: `৳${amount.toFixed(2)}` });

const TICKET_ID = ApiParam({ name: "id", description: "Ticket ID (bigint as numeric string)", schema: { type: "string", pattern: "^\\d+$" }, example: "301" });

const TICKET_NOT_FOUND = ApiNotFoundResponse({ description: "`support.errors.ticketNotFound`", schema: errorSchema(404, "Not Found", "Ticket not found") });

const ACCESS_DENIED = ApiForbiddenResponse({
    description: "Ticket of another store (`support.errors.accessDenied`), wrong role or missing `support.manage`",
    schema: errorSchema(403, "Forbidden", "You do not have access to this ticket"),
});

const TICKET = {
    id: "301", ticketNumber: "TK-MGZ4K2A1F3", userId: "5012", orderId: "5501", storeId: "7", category: "PRODUCT_QUALITY",
    subject: "2 eggs broken in my order", status: "OPEN", priority: "HIGH", assignedToId: null,
    lastMessageAt: "2026-10-20T07:12:00.000Z", firstResponseAt: null, resolution: null, resolvedAt: null,
    createdAt: "2026-10-20T07:12:00.000Z", updatedAt: "2026-10-20T07:12:00.000Z",
};

const ORDER = {
    id: "5501", orderNumber: "QC-261020-A1B2C3", status: "DELIVERED", paymentMethod: "UPI", paymentStatus: "PAID",
    total: money(612), placedAt: "2026-10-20T06:30:00.000Z", deliveredAt: "2026-10-20T06:49:00.000Z",
};

export const ApiAdminSupportController = () =>
    applyDecorators(
        ApiTags("AdminSupport"),
        ApiBearerAuth(),
        ApiHeader({ name: "Accept-Language", required: false, example: "en" }),
        ApiUnauthorizedResponse({ description: "Missing / invalid token", schema: errorSchema(401, "Unauthorized", "Unauthorized") }),
    );

export const ApiStoreSupportController = () =>
    applyDecorators(
        ApiTags("StoreSupport"),
        ApiBearerAuth(),
        ApiHeader({ name: "Accept-Language", required: false, example: "en" }),
        ApiUnauthorizedResponse({ description: "Missing / invalid token", schema: errorSchema(401, "Unauthorized", "Unauthorized") }),
    );

export const ApiTicketQueue = (admin = false) =>
    applyDecorators(
        ApiOperation({
            summary: admin ? "Complaint queue (all stores)" : "Complaint queue of my store",
            description:
                "Requires `support.manage` (store: managers and staff with the SUPPORT duty). Filters: `status`, `priority`, `category`, `orderId`, `assignedToId`, `unassigned`, `escalated`, `q` " +
                "(ticket no / subject), `from` / `to` (created, UTC days)" +
                (admin ? ", `storeId`" : "") +
                ". Sort: `priority` (default: urgent first, then latest activity), `newest`, `oldest`, `last_message`. " +
                "Each row carries the customer, assignee, message count and an order summary.",
        }),
        ApiOkResponse({
            description: "One page",
            schema: {
                example: {
                    items: [
                        {
                            ...TICKET,
                            user: { id: "5012", name: "Ayesha", phone: "+8801711222333", role: "CUSTOMER" },
                            assignee: null,
                            _count: { messages: 1 },
                            order: ORDER,
                        },
                    ],
                    total: 14, page: 1, limit: 20,
                },
            },
        }),
        ApiBadRequestResponse({ description: "Invalid filter", schema: errorSchema(400, "Bad Request", ["category must be one of the following values: ..."]) }),
        ACCESS_DENIED,
    );

export const ApiTicketThread = () =>
    applyDecorators(
        ApiOperation({
            summary: "Complaint details with full thread",
            description:
                "Requires `support.manage`. Includes internal notes, the customer, the assignee and the related order with its lines " +
                "(what was ordered vs picked) so the complaint can be verified. `attachments` lists every file in the thread with its forensic " +
                "`metadata` (flags edited / aiSuspected / noCameraData / dateMismatch / reused, `riskScore` 0-100); open the file with `GET /account/media/{id}/file`.",
        }),
        TICKET_ID,
        ApiOkResponse({
            description: "Ticket",
            schema: {
                example: {
                    ...TICKET,
                    customer: { id: "5012", name: "Ayesha", phone: "+8801711222333", role: "CUSTOMER", createdAt: "2025-03-02T10:00:00.000Z" },
                    assignee: null,
                    order: {
                        ...ORDER,
                        deliveryPartnerId: "77",
                        items: [{ id: "9001", title: "Farm Fresh Eggs", variantLabel: "12 pcs", sku: "EGG-12", quantity: 1, pickedQty: 1, unitPrice: money(160), lineTotal: money(160) }],
                    },
                    messages: [
                        { id: "811", ticketId: "301", senderId: "5012", senderRole: "CUSTOMER", body: "Two eggs were broken.", attachmentIds: [9012], isInternal: false, createdAt: "2026-10-20T07:12:00.000Z" },
                    ],
                },
            },
        }),
        TICKET_NOT_FOUND,
        ACCESS_DENIED,
    );

export const ApiTicketReply = () =>
    applyDecorators(
        ApiOperation({
            summary: "Reply to the customer (or add an internal note)",
            description:
                "Requires `support.manage`. A visible reply sets status WAITING_CUSTOMER, records the first response time and notifies " +
                "the customer in their language. `isInternal: true` is a staff-only note (status unchanged, no notification).",
        }),
        TICKET_ID,
        ApiBody({
            type: StaffMessageDto,
            examples: {
                reply: { summary: "Reply", value: { body: "Sorry! Could you share a photo of the broken eggs?" } },
                note: { summary: "Internal note", value: { body: "Picker confirms tray was cracked at packing.", isInternal: true } },
            },
        }),
        ApiOkResponse({ description: "Sent", schema: { example: { success: true } } }),
        ApiForbiddenResponse({ description: "Ticket CLOSED (`ticketClosed`) or not your store", schema: errorSchema(403, "Forbidden", "This ticket is closed") }),
        TICKET_NOT_FOUND,
    );

export const ApiTicketUpdate = () =>
    applyDecorators(
        ApiOperation({
            summary: "Change status / priority / assignee",
            description:
                "Requires `support.manage`. Store managers can assign a manager / staff of the ticket's store; admins can also assign admins. " +
                "RESOLVED / CLOSED set `resolvedAt`; moving back to an open status clears it. Prefer `/resolve` to close with a note.",
        }),
        TICKET_ID,
        ApiBody({
            type: UpdateTicketDto,
            examples: {
                assign: { summary: "Assign to staff", value: { assignedToId: 120, status: "IN_PROGRESS" } },
                escalate: { summary: "Escalate", value: { priority: "URGENT" } },
            },
        }),
        ApiOkResponse({ description: "Updated ticket", schema: { example: { ...TICKET, status: "IN_PROGRESS", assignedToId: "120" } } }),
        ApiBadRequestResponse({ description: "Assignee not allowed (`invalidAssignee`, code INVALID_ASSIGNEE)", schema: errorSchema(400, "Bad Request", "The assignee must be a manager or staff member of this ticket's store", "INVALID_ASSIGNEE") }),
        TICKET_NOT_FOUND,
        ACCESS_DENIED,
    );

export const ApiTicketResolve = () =>
    applyDecorators(
        ApiOperation({
            summary: "Resolve a complaint",
            description:
                "Requires `support.manage`. Posts `resolution` to the thread as a visible message, stores it on the ticket, sets RESOLVED " +
                "(or CLOSED with `close: true`), assigns the ticket to you if unassigned and notifies the customer. Refunds / wallet credits " +
                "are done through the order / wallet APIs; mention them in the resolution text.",
        }),
        TICKET_ID,
        ApiBody({
            type: ResolveTicketDto,
            examples: {
                resolve: { summary: "Resolve", value: { resolution: "Refunded ৳120 to your wallet for the damaged eggs. Sorry for the trouble!" } },
                close: { summary: "Close silently", value: { resolution: "Duplicate of TK-MGZ4K2A1F2", close: true, notifyCustomer: false } },
            },
        }),
        ApiOkResponse({
            description: "Resolved ticket",
            schema: {
                example: {
                    ...TICKET, status: "RESOLVED", assignedToId: "12", resolution: "Refunded ৳120 to your wallet for the damaged eggs. Sorry for the trouble!",
                    firstResponseAt: "2026-10-20T07:20:00.000Z", resolvedAt: "2026-10-20T07:31:00.000Z",
                },
            },
        }),
        ApiForbiddenResponse({ description: "Already CLOSED or not your store", schema: errorSchema(403, "Forbidden", "This ticket is closed") }),
        TICKET_NOT_FOUND,
    );

export const ApiSupportSummary = (admin = false) =>
    applyDecorators(
        ApiOperation({
            summary: admin ? "Complaint KPIs (all stores or one store)" : "Complaint KPIs of my store",
            description:
                "Requires `support.manage`. For tickets created in `from`..`to` (default last 30 days): totals, resolution rate, counts by " +
                "status / category / priority, average first-response minutes and resolution hours, daily created vs resolved. " +
                "`backlog` is the current open queue (not limited to the window).",
        }),
        ApiOkResponse({
            description: "Summary",
            schema: {
                example: {
                    from: "2026-09-21", to: "2026-10-20", total: 42, resolved: 37, resolutionRate: 88.1,
                    byStatus: { OPEN: 2, IN_PROGRESS: 1, WAITING_CUSTOMER: 2, RESOLVED: 30, CLOSED: 7 },
                    byCategory: { ORDER_ISSUE: 12, PRODUCT_QUALITY: 15, DELIVERY: 9, REFUND: 4, OTHER: 2 },
                    byPriority: { LOW: 5, MEDIUM: 25, HIGH: 10, URGENT: 2 },
                    backlog: { open: 5, byPriority: { MEDIUM: 3, HIGH: 2 }, unassigned: 1 },
                    avgFirstResponseMinutes: 11.4,
                    avgResolutionHours: 3.2,
                    trend: [{ day: "2026-10-19", created: 3, resolved: 2 }, { day: "2026-10-20", created: 1, resolved: 0 }],
                },
            },
        }),
        ACCESS_DENIED,
    );

export const ApiTicketEscalate = () =>
    applyDecorators(
        ApiOperation({
            summary: "Escalate a ticket to the admin team",
            description:
                "Store manager only. Sets `escalatedAt` / `escalationNote`, raises priority to at least HIGH, adds an internal note and notifies admins. " +
                "Admins find it with `GET /admin/support/tickets?escalated=true`. The store keeps working the ticket.",
        }),
        TICKET_ID,
        ApiBody({ type: EscalateTicketDto, examples: { escalate: { value: { note: "Third wrong-item complaint from the same supplier batch this week" } } } }),
        ApiOkResponse({ description: "Updated ticket", schema: { example: { id: "301", priority: "HIGH", escalatedAt: "2026-10-22T10:00:00.000Z", escalatedById: "2", escalationNote: "Third wrong-item complaint from the same supplier batch this week" } } }),
        ApiBadRequestResponse({ description: "Already escalated (code ALREADY_ESCALATED)", schema: errorSchema(400, "Bad Request", "This ticket is already escalated", "ALREADY_ESCALATED") }),
    );
