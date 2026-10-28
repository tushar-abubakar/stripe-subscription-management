import { AuthUser } from "@common/types/auth.type";
import { money, num, pageParams, todayInTz } from "@common/utils/helpers.util";
import { CurrencyService } from "@core/currency/currency.service";
import { PrismaService } from "@core/database/prisma.service";
import { LocaleService } from "@core/locale/locale.service";
import { ApprovalHandler, openApproval, toJson } from "./approvals.repo";
import { CreateReturnInput } from "./approvals.types";
import { Tx } from "@modules/inventory/inventory.types";
import {
    NotificationsService,
} from "@modules/notifications/notifications.service";
import { PaymentsService } from "@modules/payments/payments.service";
import {
    BadRequestException,
    ConflictException,
    Injectable,
    NotFoundException,
} from "@nestjs/common";
import { PageQueryDto } from "@common/dto/page-query.dto";
import {
    ApprovalType,
    BatchStatus,
    MediaPurpose,
    MediaStatus,
    OrderStatus,
    StockMovementType,
    UserRole,
} from "@prisma-client/enums";
import { I18nService } from "nestjs-i18n";
import { StockService } from "@modules/inventory/stock.service";

/** How long after delivery a customer may ask for a return / exchange. */
export const RETURN_WINDOW_HOURS = 48;

const RETURN_TYPES = [ApprovalType.ORDER_RETURN, ApprovalType.ORDER_EXCHANGE];

interface ReturnPayload {
    items: { orderItemId: string; quantity: number; reason: string; sku: string | null; unitValue: number }[];
    mediaIds: number[];
    refundEstimate: number;
}

/**
 * Customer returns (refund) and exchanges (replacement). Requested by the
 * customer, decided by the store manager of the order's store (admins can
 * override), applied as stock movements + refund in one decision.
 */
@Injectable()
export class ReturnsService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly stock: StockService,
        private readonly payments: PaymentsService,
        private readonly notify: NotificationsService,
        private readonly i18n: I18nService,
        private readonly locale: LocaleService,
        private readonly currency: CurrencyService,
    ) {}

    private t(key: string, args?: Record<string, unknown>) {
        return this.i18n.translate(`approvals.${key}`, args ? { args } : {}) as string;
    }

    async create(user: AuthUser, orderId: bigint, dto: CreateReturnInput) {
        const order = await this.prisma.order.findFirst({
            where: { id: orderId, userId: user.id },
            include: { items: true },
        });
        if (!order) throw new NotFoundException(this.t("errors.orderNotFound"));
        if (order.status !== OrderStatus.DELIVERED || !order.deliveredAt)
            throw new BadRequestException({ message: this.t("errors.notDelivered"), code: "ORDER_NOT_DELIVERED" });
        if (Date.now() - order.deliveredAt.getTime() > RETURN_WINDOW_HOURS * 3600_000)
            throw new BadRequestException({
                message: this.t("errors.windowClosed", { hours: RETURN_WINDOW_HOURS }),
                code: "RETURN_WINDOW_CLOSED",
            });

        const ids = dto.items.map((i) => String(i.orderItemId));
        if (new Set(ids).size !== ids.length) throw new BadRequestException(this.t("errors.duplicateItem"));
        const items = dto.items.map((line) => {
            const item = order.items.find((i) => i.id === BigInt(line.orderItemId));
            if (!item || !item.variantId || item.parentId)
                throw new BadRequestException({ message: this.t("errors.itemNotReturnable", { id: String(line.orderItemId) }), code: "ITEM_NOT_RETURNABLE" });
            if (line.quantity > item.quantity - item.returnedQty)
                throw new BadRequestException({ message: this.t("errors.qtyExceeded", { sku: item.sku ?? "" }), code: "RETURN_QTY_EXCEEDED" });
            return {
                orderItemId: item.id.toString(),
                quantity: line.quantity,
                reason: line.reason,
                sku: item.sku,
                unitValue: money(num(item.lineTotal) / item.quantity),
            };
        });

        const mediaIds = dto.mediaIds ?? [];
        if (mediaIds.length) {
            const ok = await this.prisma.mediaFile.count({
                where: {
                    id: { in: mediaIds.map((m) => BigInt(m)) },
                    uploadedById: user.id,
                    purpose: MediaPurpose.SUPPORT,
                    status: MediaStatus.READY,
                    deletedAt: null,
                },
            });
            if (ok !== mediaIds.length)
                throw new BadRequestException({ message: this.t("errors.mediaInvalid"), code: "RETURN_MEDIA_INVALID" });
        }

        const payload: ReturnPayload = {
            items,
            mediaIds,
            refundEstimate: money(items.reduce((s, i) => s + i.unitValue * i.quantity, 0)),
        };
        const type = dto.type === "EXCHANGE" ? ApprovalType.ORDER_EXCHANGE : ApprovalType.ORDER_RETURN;
        const request = await this.prisma.$transaction(async (tx) => {
            // One open return / exchange per order at a time.
            const open = await tx.approvalRequest.findFirst({
                where: { targetType: "Order", targetId: order.id, type: { in: RETURN_TYPES }, status: "PENDING" },
            });
            if (open)
                throw new ConflictException({ message: this.t("errors.alreadyOpen"), code: "APPROVAL_ALREADY_PENDING", approvalId: open.id });
            return openApproval(tx, user, {
                type,
                storeId: order.storeId,
                targetType: "Order",
                targetId: order.id,
                note: dto.note,
                payload: payload as unknown as Record<string, unknown>,
                snapshot: { orderNumber: order.orderNumber, deliveredAt: order.deliveredAt, total: num(order.total) },
            });
        });

        // Tell the store's managers there is something to decide.
        const managers = await this.prisma.user.findMany({
            where: { storeId: order.storeId, role: UserRole.STORE_MANAGER, deletedAt: null },
            select: { id: true },
        });
        await Promise.all(
            managers.map((m) =>
                this.notify.notify(m.id, "APPROVAL", this.t("notification.newReturn"), order.orderNumber, {
                    approvalId: request.id.toString(),
                }),
            ),
        );
        return this.present(request);
    }

    present(r: { payload: unknown; [k: string]: unknown }) {
        const p = r.payload as ReturnPayload;
        return {
            ...r,
            payload: {
                ...p,
                refundEstimate: this.currency.format(p?.refundEstimate ?? 0),
            },
        };
    }

    async mine(user: AuthUser, q: PageQueryDto) {
        const { take, skip, page, limit } = pageParams(q);
        const where = { requestedById: user.id, type: { in: RETURN_TYPES } };
        const [rows, total] = await Promise.all([
            this.prisma.approvalRequest.findMany({ where, orderBy: { id: "desc" }, take, skip }),
            this.prisma.approvalRequest.count({ where }),
        ]);
        return { items: rows.map((r) => this.present(r)), total, page, limit };
    }

    /** Put returned units back on sale (into the batch they were sold from, if still sellable). */
    private async restock(
        tx: Tx,
        item: { id: bigint; storeProductId: bigint | null },
        qty: number,
        storeId: bigint,
        requestId: bigint,
        actor: AuthUser,
        tz: string,
        refType: "RETURN" | "EXCHANGE",
    ) {
        if (!item.storeProductId) return { restocked: 0, reason: "NO_LISTING" };
        const sp = await tx.storeProduct.findUniqueOrThrow({ where: { id: item.storeProductId } });
        const base = {
            storeId,
            storeProductId: sp.id,
            type: StockMovementType.RETURN,
            refType,
            refId: requestId,
            actorId: actor.id,
        };
        if (sp.trackBatches) {
            const sold = await tx.orderItemBatch.findFirst({ where: { orderItemId: item.id }, orderBy: { id: "desc" } });
            const batch = sold ? await tx.inventoryBatch.findUnique({ where: { id: sold.batchId } }) : null;
            const sellable =
                !!batch &&
                (batch.status === BatchStatus.ACTIVE || batch.status === BatchStatus.DEPLETED) &&
                (!batch.expiryDate || batch.expiryDate >= todayInTz(tz));
            if (!batch || !sellable) {
                // Expired / recalled / unknown batch: the units are not put back on sale.
                await tx.stockMovement.create({
                    data: { ...base, batchId: batch?.id, quantity: 0, balanceAfter: sp.availableQty, note: `Returned ${qty} unit(s), not resellable` },
                });
                return { restocked: 0, reason: "BATCH_NOT_SELLABLE" };
            }
            const b = await tx.inventoryBatch.update({
                where: { id: batch.id },
                data: { availableQty: { increment: qty }, status: BatchStatus.ACTIVE },
            });
            const balanceAfter = await this.stock.bumpAvailable(tx, sp.id, qty);
            await tx.stockMovement.create({
                data: { ...base, batchId: b.id, quantity: qty, balanceAfter, batchBalanceAfter: b.availableQty },
            });
            await this.stock.refreshMrp(tx, sp.id, actor.id, tz);
            return { restocked: qty, batchId: b.id.toString() };
        }
        const balanceAfter = await this.stock.bumpAvailable(tx, sp.id, qty);
        await tx.stockMovement.create({ data: { ...base, quantity: qty, balanceAfter } });
        return { restocked: qty };
    }

    /** Take replacement units out of stock (FEFO) for an exchange. */
    private async issueReplacement(
        tx: Tx,
        item: { storeProductId: bigint | null; sku: string | null },
        qty: number,
        storeId: bigint,
        requestId: bigint,
        actor: AuthUser,
        tz: string,
    ) {
        if (!item.storeProductId) throw new ConflictException({ message: this.t("errors.noStock", { sku: item.sku ?? "" }), code: "OUT_OF_STOCK" });
        const sp = await tx.storeProduct.findUniqueOrThrow({ where: { id: item.storeProductId } });
        if (sp.availableQty - sp.reservedQty < qty)
            throw new ConflictException({ message: this.t("errors.noStock", { sku: item.sku ?? "" }), code: "OUT_OF_STOCK" });
        const base = { storeId, storeProductId: sp.id, type: StockMovementType.SALE, refType: "EXCHANGE", refId: requestId, actorId: actor.id };
        if (!sp.trackBatches) {
            const balanceAfter = await this.stock.bumpAvailable(tx, sp.id, -qty);
            await tx.stockMovement.create({ data: { ...base, quantity: -qty, balanceAfter } });
            return [];
        }
        const picks = await this.stock.pickFefo(tx, sp.id, qty, sp.minSellableDays, tz);
        const out: { batchNumber: string; quantity: number }[] = [];
        for (const pick of picks) {
            const b = await tx.inventoryBatch.update({
                where: { id: pick.batchId },
                data: { availableQty: { decrement: pick.take } },
            });
            if (b.availableQty === 0) await tx.inventoryBatch.update({ where: { id: b.id }, data: { status: BatchStatus.DEPLETED } });
            const balanceAfter = await this.stock.bumpAvailable(tx, sp.id, -pick.take);
            await tx.stockMovement.create({
                data: { ...base, batchId: b.id, quantity: -pick.take, balanceAfter, batchBalanceAfter: b.availableQty },
            });
            out.push({ batchNumber: pick.batchNumber, quantity: pick.take });
        }
        await this.stock.refreshMrp(tx, sp.id, actor.id, tz);
        return out;
    }

    private notifyCustomer(userId: bigint, approved: boolean, orderNumber: string) {
        return this.notify.notify(
            userId,
            "RETURN",
            this.t(approved ? "notification.approved" : "notification.rejected"),
            orderNumber,
        );
    }

    handlers(): Partial<Record<ApprovalType, ApprovalHandler>> {
        const decide: ApprovalHandler = async (tx, req, { approve, actor, options }) => {
            const order = await tx.order.findUniqueOrThrow({ where: { id: req.targetId }, include: { store: { select: { timezone: true } } } });
            if (!approve)
                return { result: {}, afterCommit: () => this.notifyCustomer(order.userId, false, order.orderNumber) };

            const p = req.payload as unknown as ReturnPayload;
            const restock = (options?.restock as boolean | undefined) ?? true;
            const tz = order.store.timezone;
            const lines: Record<string, unknown>[] = [];
            let maxRefund = 0;

            for (const line of p.items) {
                // Atomic: never return more than was bought (two decisions can't double-count).
                const ok = await tx.$executeRaw`
                    UPDATE "OrderItem" SET "returnedQty" = "returnedQty" + ${line.quantity}
                    WHERE id = ${BigInt(line.orderItemId)} AND "returnedQty" + ${line.quantity} <= quantity`;
                if (ok !== 1)
                    throw new ConflictException({ message: this.t("errors.qtyExceeded", { sku: line.sku ?? "" }), code: "RETURN_QTY_EXCEEDED" });
                const item = await tx.orderItem.findUniqueOrThrow({ where: { id: BigInt(line.orderItemId) } });
                const back = restock
                    ? await this.restock(tx, item, line.quantity, order.storeId, req.id, actor, tz, req.type === ApprovalType.ORDER_EXCHANGE ? "EXCHANGE" : "RETURN")
                    : { restocked: 0, reason: "NOT_RESTOCKED" };
                const replacement =
                    req.type === ApprovalType.ORDER_EXCHANGE
                        ? await this.issueReplacement(tx, item, line.quantity, order.storeId, req.id, actor, tz)
                        : undefined;
                maxRefund += line.unitValue * line.quantity;
                lines.push({ orderItemId: line.orderItemId, quantity: line.quantity, ...back, ...(replacement && { replacement }) });
            }

            const refund =
                req.type === ApprovalType.ORDER_RETURN
                    ? money(Math.min((options?.refundAmount as number | undefined) ?? maxRefund, maxRefund))
                    : 0;
            await tx.orderEvent.create({
                data: {
                    orderId: order.id,
                    status: order.status,
                    title: req.type === ApprovalType.ORDER_RETURN ? "Return approved" : "Exchange approved",
                    note: `Request #${req.id}${refund ? `, refund ${refund}` : ""}`,
                    actorId: actor.id,
                    actorRole: actor.role,
                },
            });
            return {
                result: toJson({ lines, refundAmount: refund, restock }) as Record<string, unknown>,
                afterCommit: async () => {
                    // Refund to the original payment / wallet (idempotent per request).
                    if (refund > 0) await this.payments.refund(order.id, refund, `return:${req.id}`);
                    await this.notifyCustomer(order.userId, true, order.orderNumber);
                },
            };
        };
        return { [ApprovalType.ORDER_RETURN]: decide, [ApprovalType.ORDER_EXCHANGE]: decide };
    }
}
