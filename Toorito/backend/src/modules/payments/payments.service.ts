import { docNumber, money, num } from "@common/utils/helpers.util";
import { CurrencyService } from "@core/currency/currency.service";
import { PrismaService } from "@core/database/prisma.service";
import { LocaleService } from "@core/locale/locale.service";
import { NotificationsService } from "@modules/notifications/notifications.service";
import {
    BadRequestException,
    Injectable,
    Logger,
    NotFoundException,
    UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Prisma } from "@prisma-client/client";
import { createHmac, randomBytes, timingSafeEqual } from "crypto";
import { I18nService } from "nestjs-i18n";
export type Tx = Prisma.TransactionClient;

/** Gateway adapter: swap the body of these 3 methods for Razorpay / Cashfree / Stripe SDK calls. */
@Injectable()
export class PaymentsService {
    private readonly log = new Logger("Payments");
    private readonly secret: string;
    private readonly gateway: string;

    constructor(
        private readonly prisma: PrismaService,
        private readonly notify: NotificationsService,
        private readonly currency: CurrencyService,
        private readonly i18n: I18nService,
        private readonly locale: LocaleService,
        config: ConfigService,
    ) {
        this.secret = config.getOrThrow<string>("payment.webhookSecret");
        this.gateway = config.getOrThrow<string>("payment.gateway");
    }

    // ---------- gateway adapter (stub) ----------
    async createGatewayOrder(
        orderNumber: string,
        amount: number,
    ): Promise<{
        gatewayOrderId: string;
        amount: number;
        currency: string;
        key?: string;
    }> {
        // e.g. const o = await razorpay.orders.create({ amount: Math.round(amount*100), currency: this.currency.code, receipt: orderNumber });
        return {
            gatewayOrderId: `order_${randomBytes(9).toString("hex")}`,
            amount,
            currency: this.currency.code,
        };
    }
    private async gatewayRefund(
        _gatewayPaymentId: string | null,
        amount: number,
    ): Promise<string> {
        return `rfnd_${randomBytes(8).toString("hex")}`; // e.g. razorpay.payments.refund(paymentId, { amount: amount*100 })
    }
    verifySignature(raw: Buffer | string, signature?: string) {
        if (!this.secret || !signature) return false;
        const a = Buffer.from(
                createHmac("sha256", this.secret).update(raw).digest("hex"),
            ),
            b = Buffer.from(signature);
        return a.length === b.length && timingSafeEqual(a, b);
    }

    // ---------- wallet (atomic + ledger, same transaction) ----------
    async walletDebit(
        tx: Tx,
        userId: bigint,
        amount: number,
        reason: "ORDER_PAYMENT" | "ADMIN_ADJUSTMENT",
        orderId?: bigint,
        key?: string,
        actorId?: bigint,
        note?: string,
    ): Promise<boolean> {
        const r = await tx.$queryRaw<
            { walletBalance: any }[]
        >`UPDATE "User" SET "walletBalance" = "walletBalance" - ${amount} WHERE id = ${userId} AND "walletBalance" >= ${amount} RETURNING "walletBalance"`;
        if (!r.length) return false;
        await tx.walletTransaction.create({
            data: {
                userId,
                type: "DEBIT",
                reason,
                amount,
                balanceAfter: r[0].walletBalance,
                orderId,
                idempotencyKey: key,
                actorId,
                note,
            },
        });
        return true;
    }
    async walletCredit(
        tx: Tx,
        userId: bigint,
        amount: number,
        reason: "REFUND" | "CASHBACK" | "TOPUP" | "ADMIN_ADJUSTMENT",
        orderId?: bigint,
        key?: string,
        actorId?: bigint,
        note?: string,
    ) {
        if (
            key &&
            (await tx.walletTransaction.findUnique({
                where: { idempotencyKey: key },
            }))
        )
            return;
        const r = await tx.$queryRaw<
            { walletBalance: any }[]
        >`UPDATE "User" SET "walletBalance" = "walletBalance" + ${amount} WHERE id = ${userId} RETURNING "walletBalance"`;
        await tx.walletTransaction.create({
            data: {
                userId,
                type: "CREDIT",
                reason,
                amount,
                balanceAfter: r[0].walletBalance,
                orderId,
                idempotencyKey: key,
                actorId,
                note,
            },
        });
    }
    /**
     * Refund `amount` of an order: wallet-paid part returns to wallet first, remainder to the original source
     * (gateway refund recorded as a REFUND transaction). Idempotent per (order, tag).
     */
    async refund(orderId: bigint, amount: number, tag: string) {
        const order = await this.prisma.order.findUniqueOrThrow({
            where: { id: orderId },
        });
        if (
            order.paymentStatus !== "PAID" &&
            order.paymentStatus !== "PARTIALLY_REFUNDED"
        )
            return { refunded: 0 };
        const key = `refund:${orderId}:${tag}`;
        if (
            (await this.prisma.walletTransaction.findUnique({
                where: { idempotencyKey: key },
            })) ||
            (await this.prisma.transaction.findUnique({
                where: { idempotencyKey: key },
            }))
        )
            return { refunded: 0, duplicate: true };
        const toWallet = Math.min(amount, num(order.walletAmountUsed));
        const toSource = money(amount - toWallet);
        let txnId: bigint | null = null;
        if (toSource > 0 && order.paymentMethod !== "COD") {
            const pay = await this.prisma.transaction.findFirst({
                where: { orderId, type: "PAYMENT", status: "SUCCESS" },
                orderBy: { id: "desc" },
            });
            const rid = await this.gatewayRefund(
                pay?.gatewayPaymentId ?? null,
                toSource,
            );
            const t = await this.prisma.transaction.create({
                data: {
                    txnNumber: docNumber("RF"),
                    orderId,
                    userId: order.userId,
                    parentId: pay?.id,
                    type: "REFUND",
                    method: pay?.method,
                    gateway: this.gateway,
                    gatewayRefundId: rid,
                    amount: toSource,
                    status: "PENDING",
                    idempotencyKey: key,
                },
            });
            txnId = t.id;
        }
        await this.prisma.$transaction(async (tx) => {
            if (toWallet > 0)
                await this.walletCredit(
                    tx,
                    order.userId,
                    toWallet,
                    "REFUND",
                    orderId,
                    toSource > 0 ? `${key}:w` : key,
                );
            const refundedTotal = amount; // ledger lives in Transaction / WalletTransaction
            await tx.order.update({
                where: { id: orderId },
                data: {
                    paymentStatus:
                        refundedTotal >= num(order.total)
                            ? "REFUNDED"
                            : "PARTIALLY_REFUNDED",
                },
            });
        });
        const customer = await this.prisma.user.findUnique({
            where: { id: order.userId },
            select: { language: true },
        });

        await this.notify.notify(
            order.userId,
            "REFUND",
            this.i18n.translate("payments.notes.refundTitle", {
                lang: this.locale.resolve(customer?.language),
            }),
            this.i18n.translate("payments.notes.refund", {
                lang: this.locale.resolve(customer?.language),
                args: {
                    amount: this.currency.format(amount).formatted,
                    orderNumber: order.orderNumber,
                },
            }),
            { orderId: orderId.toString() },
        );
        return { refunded: amount, transactionId: txnId };
    }

    // ---------- webhook ----------
    /** Idempotent: unique (gateway,eventId) row is inserted first; replays are ignored. */
    async handleWebhook(
        gateway: string,
        raw: Buffer,
        signature: string | undefined,
        body: any,
    ) {
        // Only the configured gateway may post events.
        if (gateway !== this.gateway) {
            throw new NotFoundException(
                this.i18n.translate("common.errors.notFound"),
            );
        }

        const ok = this.verifySignature(raw, signature);
        if (!ok)
            throw new UnauthorizedException(
                this.i18n.translate("payments.errors.badSignature"),
            );
        const eventId: string =
            body.id ?? body.event_id ?? body.payload?.payment?.entity?.id;
        if (!eventId)
            throw new BadRequestException(
                this.i18n.translate("payments.errors.noEventId"),
            );
        try {
            await this.prisma.webhookEvent.create({
                data: {
                    gateway,
                    eventId,
                    eventType: body.event ?? body.type ?? "unknown",
                    payload: body,
                    signatureOk: true,
                },
            });
        } catch (e: any) {
            if (e.code === "P2002") return { duplicate: true };
            throw e;
        }

        const ev = await this.prisma.webhookEvent.findUniqueOrThrow({
            where: { gateway_eventId: { gateway, eventId } },
        });
        try {
            const ent = body.payload?.payment?.entity ?? body.data ?? {};
            const gatewayOrderId: string | undefined =
                ent.order_id ?? ent.orderId;
            const paymentId: string | undefined = ent.id ?? ent.paymentId;
            if (!gatewayOrderId) {
                await this.prisma.webhookEvent.update({
                    where: { id: ev.id },
                    data: { status: "IGNORED", processedAt: new Date() },
                });
                return { ignored: true };
            }
            const txn = await this.prisma.transaction.findFirst({
                where: { gatewayOrderId, type: "PAYMENT" },
            });
            if (!txn || !txn.orderId) {
                await this.prisma.webhookEvent.update({
                    where: { id: ev.id },
                    data: { status: "IGNORED", processedAt: new Date() },
                });
                return { ignored: true };
            }
            const type: string = body.event ?? body.type;
            if (/captured|success|paid/.test(type))
                await this.markPaid(txn.id, txn.orderId, paymentId, ent);
            else if (/failed/.test(type))
                await this.prisma.transaction.update({
                    where: { id: txn.id },
                    data: {
                        status: "FAILED",
                        failureCode: ent.error_code,
                        failureReason: ent.error_description?.slice(0, 255),
                        gatewayResponse: ent,
                    },
                });
            await this.prisma.webhookEvent.update({
                where: { id: ev.id },
                data: {
                    status: "PROCESSED",
                    processedAt: new Date(),
                    attempts: { increment: 1 },
                },
            });
            return { ok: true };
        } catch (e: any) {
            await this.prisma.webhookEvent.update({
                where: { id: ev.id },
                data: {
                    status: "FAILED",
                    errorMessage: String(e.message).slice(0, 500),
                    attempts: { increment: 1 },
                },
            });
            throw e;
        }
    }

    private async markPaid(
        txnId: bigint,
        orderId: bigint,
        paymentId: string | undefined,
        ent: any,
    ) {
        const order = await this.prisma.order.findUniqueOrThrow({
            where: { id: orderId },
        });
        await this.prisma.$transaction(async (tx) => {
            await tx.transaction.update({
                where: { id: txnId },
                data: {
                    status: "SUCCESS",
                    gatewayPaymentId: paymentId,
                    gatewayResponse: ent,
                    completedAt: new Date(),
                },
            });
            if (order.status === "PENDING_PAYMENT") {
                await tx.order.update({
                    where: { id: orderId },
                    data: {
                        status: "PLACED",
                        paymentStatus: "PAID",
                        paymentExpiresAt: null,
                    },
                });
                await tx.orderEvent.create({
                    data: {
                        orderId,
                        status: "PLACED",
                        title: "Payment received",
                    },
                });
            } else if (
                order.status === "CANCELLED" ||
                order.status === "FAILED"
            ) {
                await tx.order.update({
                    where: { id: orderId },
                    data: { paymentStatus: "PAID" },
                }); // paid after expiry -> refund below
            } else
                await tx.order.update({
                    where: { id: orderId },
                    data: { paymentStatus: "PAID" },
                });
        });
        if (order.status === "CANCELLED" || order.status === "FAILED")
            await this.refund(
                orderId,
                num(order.total) - num(order.walletAmountUsed),
                "late-payment",
            );
    }
}
