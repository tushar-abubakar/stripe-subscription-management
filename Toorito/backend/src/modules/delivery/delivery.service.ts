import { EventBus } from "@common/events/events";
import { AuthUser } from "@common/types/auth.type";
import { docNumber, num, sha256 } from "@common/utils/helpers.util";
import { AppConfig } from "@config/config.type";
import { CurrencyService } from "@core/currency/currency.service";
import { PrismaService } from "@core/database/prisma.service";
import { LocaleService } from "@core/locale/locale.service";
import { RedisService } from "@core/redis/redis.service";
import { NotificationsService } from "@modules/notifications/notifications.service";
import { OrdersService } from "@modules/orders/orders.service";
import {
    BadRequestException,
    ConflictException,
    ForbiddenException,
    Injectable,
    Logger,
    NotFoundException,
    OnModuleInit,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Cron } from "@nestjs/schedule";
import { randomInt } from "crypto";
import { I18nService } from "nestjs-i18n";
import { Subscription } from "rxjs";

const geoKey = (storeId: bigint | string) => `geo:store:${storeId}`;

@Injectable()
export class DeliveryService implements OnModuleInit {
    private readonly log = new Logger("Delivery");
    private readonly deliveryConfig: AppConfig["delivery"];
    private sub?: Subscription;

    constructor(
        private readonly prisma: PrismaService,
        private readonly redis: RedisService,
        private readonly bus: EventBus,
        private readonly orders: OrdersService,
        private readonly notify: NotificationsService,
        private readonly i18n: I18nService,
        private readonly locale: LocaleService,
        private readonly currency: CurrencyService,
        config: ConfigService,
    ) {
        this.deliveryConfig =
            config.getOrThrow<AppConfig["delivery"]>("delivery");
    }

    /** Preferred language of a user (falls back to the default language). */
    private async languageOf(userId: bigint): Promise<string> {
        const user = await this.prisma.user.findUnique({
            where: { id: userId },
            select: { language: true },
        });

        return this.locale.resolve(user?.language);
    }

    onModuleInit() {
        this.sub = this.bus.stream.subscribe((e) => {
            if (e.type === "order.ready")
                this.autoAssign(e.orderId).catch((x) =>
                    this.log.warn(`autoAssign ${e.orderId}: ${x.message}`),
                );
            if (e.type === "order.cancelled")
                this.afterCancel(e.orderId).catch(() => undefined);
        });
    }

    // ===================== partner presence & location =====================
    async setOnline(user: AuthUser, online: boolean) {
        const u = await this.prisma.user.findUniqueOrThrow({
            where: { id: user.id },
            include: { partnerProfile: true },
        });
        if (
            u.approvalStatus !== "APPROVED" ||
            u.partnerProfile?.kycStatus !== "VERIFIED"
        )
            throw new ForbiddenException({
                message: this.i18n.translate(
                    "delivery.errors.verificationPending",
                ),
                code: "KYC_REQUIRED",
            });
        await this.prisma.deliveryPartnerProfile.update({
            where: { userId: user.id },
            data: { isOnline: online },
        });
        if (!online)
            await this.redis.client.zrem(
                geoKey(user.storeId!),
                user.id.toString(),
            );
        return { isOnline: online };
    }
    /** Hot path: Redis only (GEO index + per-order latest point); DB checkpoint at most once a minute. */
    async updateLocation(
        user: AuthUser,
        lat: number,
        lng: number,
        heading?: number,
    ) {
        if (
            !Number.isFinite(lat) ||
            !Number.isFinite(lng) ||
            Math.abs(lat) > 90 ||
            Math.abs(lng) > 180
        )
            throw new BadRequestException(
                this.i18n.translate("delivery.errors.badCoordinates"),
            );
        const r = this.redis.client;
        await r.geoadd(geoKey(user.storeId!), lng, lat, user.id.toString());
        const orderIds = await r.smembers(`partner:orders:${user.id}`);
        const point = JSON.stringify({ lat, lng, heading, at: Date.now() });
        if (orderIds.length) {
            const p = r.pipeline();
            for (const id of orderIds)
                p.set(`loc:order:${id}`, point, "EX", 3600);
            await p.exec();
        }
        if (await r.set(`loc:db:${user.id}`, "1", "EX", 60, "NX"))
            await this.prisma.deliveryPartnerProfile
                .update({
                    where: { userId: user.id },
                    data: {
                        lastLatitude: lat,
                        lastLongitude: lng,
                        lastLocationAt: new Date(),
                    },
                })
                .catch(() => undefined);
        return { orderIds };
    }

    // ===================== assignment =====================
    async autoAssign(orderId: bigint) {
        const o = await this.prisma.order.findUnique({
            where: { id: orderId },
            include: { store: { select: { latitude: true, longitude: true } } },
        });
        if (!o || o.status !== "READY_FOR_PICKUP") return null;
        if (
            await this.prisma.delivery.count({
                where: {
                    orderId,
                    status: {
                        in: [
                            "ASSIGNED",
                            "ACCEPTED",
                            "REACHED_STORE",
                            "PICKED_UP",
                            "REACHED_CUSTOMER",
                        ],
                    },
                },
            })
        )
            return null;
        const rejected = new Set(
            await this.redis.client.smembers(`rej:${orderId}`),
        );
        const near = (await this.redis.client.call(
            "GEOSEARCH",
            geoKey(o.storeId),
            "FROMLONLAT",
            String(o.store.longitude),
            String(o.store.latitude),
            "BYRADIUS",
            "15",
            "km",
            "ASC",
            "COUNT",
            "10",
        )) as string[];
        for (const pid of near ?? []) {
            if (rejected.has(pid)) continue;
            const p = await this.prisma.deliveryPartnerProfile.findFirst({
                where: {
                    userId: BigInt(pid),
                    isOnline: true,
                    isAvailable: true,
                    activeOrderCount: {
                        lt: this.deliveryConfig.maxActiveOrders,
                    },
                    user: { status: "ACTIVE", approvalStatus: "APPROVED" },
                },
            });
            if (!p) continue;
            try {
                return await this.assign(orderId, BigInt(pid), {
                    id: 0n,
                } as any);
            } catch {
                continue;
            }
        }
        return null;
    }

    async assign(
        orderId: bigint,
        partnerId: bigint,
        actor: Pick<AuthUser, "id" | "storeId">,
    ) {
        const code = String(randomInt(1000, 10000));
        const d = await this.prisma.$transaction(async (tx) => {
            const o = await tx.order.findFirst({
                where: {
                    id: orderId,
                    ...(actor.storeId ? { storeId: actor.storeId } : {}),
                },
            });
            if (!o)
                throw new NotFoundException(
                    this.i18n.translate("delivery.errors.orderNotFound"),
                );
            if (o.status !== "READY_FOR_PICKUP")
                throw new ConflictException(
                    this.i18n.translate("delivery.errors.orderNotReady"),
                );
            const p = await tx.deliveryPartnerProfile.findFirst({
                where: {
                    userId: partnerId,
                    kycStatus: "VERIFIED",
                    user: {
                        storeId: o.storeId,
                        status: "ACTIVE",
                        approvalStatus: "APPROVED",
                    },
                },
            });
            if (!p)
                throw new BadRequestException(
                    this.i18n.translate("delivery.errors.partnerNotEligible"),
                );
            const cod =
                o.paymentMethod === "COD" && o.paymentStatus !== "PAID"
                    ? num(o.total) - num(o.walletAmountUsed)
                    : null;
            const del = await tx.delivery.create({
                data: {
                    orderId,
                    partnerId,
                    handoverCodeHash: sha256(`${orderId}:${code}`),
                    cashToCollect: cod,
                    partnerEarning: this.deliveryConfig.earningPerOrder,
                },
            }); // partial unique index blocks double assignment
            await tx.order.update({
                where: { id: orderId },
                data: { deliveryPartnerId: partnerId },
            });
            await tx.deliveryPartnerProfile.update({
                where: { userId: partnerId },
                data: { activeOrderCount: { increment: 1 } },
            });
            return del;
        });
        await this.redis.client.set(`handover:${orderId}`, code, "EX", 86400);
        await this.redis.client.sadd(
            `partner:orders:${partnerId}`,
            orderId.toString(),
        );
        await this.notify.notify(
            partnerId,
            "DELIVERY_ASSIGNED",
            this.i18n.translate("delivery.notification.newDelivery.title", {
                lang: await this.languageOf(partnerId),
            }),
            this.i18n.translate("delivery.notification.newDelivery.body", {
                lang: await this.languageOf(partnerId),
            }),
            { deliveryId: d.id.toString(), orderId: orderId.toString() },
        );
        return d;
    }
    /** Retry orders that are READY but still unassigned (no partner online earlier). */
    @Cron("*/30 * * * * *")
    async retryUnassigned() {
        const lock = await this.redis.lock("cron:assign", 25);
        if (!lock) return;
        try {
            const ready = await this.prisma.order.findMany({
                where: { status: "READY_FOR_PICKUP", deliveryPartnerId: null },
                select: { id: true },
                take: 50,
            });
            for (const o of ready) await this.autoAssign(o.id);
            // auto-reassign stale ASSIGNED (not accepted within 2 minutes)
            const stale = await this.prisma.delivery.findMany({
                where: {
                    status: "ASSIGNED",
                    assignedAt: { lt: new Date(Date.now() - 120000) },
                },
                take: 50,
            });
            for (const d of stale)
                await this.reject(
                    d.partnerId,
                    d.id,
                    "Not accepted in time",
                ).catch(() => undefined);
        } finally {
            await lock();
        }
    }
    private async afterCancel(orderId: bigint) {
        const ds = await this.prisma.delivery.findMany({
            where: { orderId, status: "CANCELLED" },
        });
        for (const d of ds) {
            await this.prisma.deliveryPartnerProfile.updateMany({
                where: { userId: d.partnerId, activeOrderCount: { gt: 0 } },
                data: { activeOrderCount: { decrement: 1 } },
            });
            await this.redis.client.srem(
                `partner:orders:${d.partnerId}`,
                orderId.toString(),
            );
        }
    }

    // ===================== partner flow =====================
    myDeliveries(partnerId: bigint, active = true) {
        return this.prisma.delivery.findMany({
            where: {
                partnerId,
                ...(active
                    ? {
                          status: {
                              in: [
                                  "ASSIGNED",
                                  "ACCEPTED",
                                  "REACHED_STORE",
                                  "PICKED_UP",
                                  "REACHED_CUSTOMER",
                              ],
                          },
                      }
                    : {}),
            },
            orderBy: { id: "desc" },
            take: 30,
            include: {
                order: {
                    select: {
                        id: true,
                        orderNumber: true,
                        customerName: true,
                        customerPhone: true,
                        deliveryAddress: true,
                        deliveryLat: true,
                        deliveryLng: true,
                        total: true,
                        paymentMethod: true,
                        instructions: true,
                        store: {
                            select: {
                                name: true,
                                addressLine: true,
                                latitude: true,
                                longitude: true,
                                phone: true,
                            },
                        },
                    },
                },
            },
        });
    }
    private async own(partnerId: bigint, id: bigint) {
        const d = await this.prisma.delivery.findFirst({
            where: { id, partnerId },
        });
        if (!d)
            throw new NotFoundException(
                this.i18n.translate("delivery.errors.notFound"),
            );
        return d;
    }

    async accept(partnerId: bigint, id: bigint) {
        const r = await this.prisma.delivery.updateMany({
            where: { id, partnerId, status: "ASSIGNED" },
            data: { status: "ACCEPTED", acceptedAt: new Date() },
        });
        if (!r.count)
            throw new ConflictException(
                this.i18n.translate("delivery.errors.cannotAccept"),
            );
        return { success: true };
    }
    async reject(partnerId: bigint, id: bigint, reason?: string) {
        const d = await this.own(partnerId, id);
        const r = await this.prisma.delivery.updateMany({
            where: { id, status: { in: ["ASSIGNED", "ACCEPTED"] } },
            data: {
                status: "REJECTED",
                cancelledAt: new Date(),
                cancelReason: reason?.slice(0, 255),
            },
        });
        if (!r.count)
            throw new ConflictException(
                this.i18n.translate("delivery.errors.cannotReject"),
            );
        await this.prisma.order.update({
            where: { id: d.orderId },
            data: { deliveryPartnerId: null },
        });
        await this.prisma.deliveryPartnerProfile.updateMany({
            where: { userId: partnerId, activeOrderCount: { gt: 0 } },
            data: { activeOrderCount: { decrement: 1 } },
        });
        await this.redis.client.sadd(`rej:${d.orderId}`, partnerId.toString());
        await this.redis.client.expire(`rej:${d.orderId}`, 3600);
        await this.redis.client.srem(
            `partner:orders:${partnerId}`,
            d.orderId.toString(),
        );
        await this.autoAssign(d.orderId);
        return { success: true };
    }
    async progress(
        partnerId: bigint,
        id: bigint,
        to: "REACHED_STORE" | "PICKED_UP" | "REACHED_CUSTOMER",
    ) {
        const d = await this.own(partnerId, id);
        const flow = {
            REACHED_STORE: ["ACCEPTED"],
            PICKED_UP: ["ACCEPTED", "REACHED_STORE"],
            REACHED_CUSTOMER: ["PICKED_UP"],
        } as const;
        if (!(flow[to] as readonly string[]).includes(d.status))
            throw new ConflictException(
                this.i18n.translate("delivery.errors.invalidTransition", {
                    args: { from: d.status, to },
                }),
            );
        const ts = {
            REACHED_STORE: { reachedStoreAt: new Date() },
            PICKED_UP: { pickedUpAt: new Date() },
            REACHED_CUSTOMER: { reachedCustomerAt: new Date() },
        }[to];
        await this.prisma.$transaction(async (tx) => {
            const u = await tx.delivery.updateMany({
                where: { id, status: d.status },
                data: { status: to, ...ts },
            });
            if (!u.count)
                throw new ConflictException(
                    this.i18n.translate("delivery.errors.stateChanged"),
                );
            if (to === "PICKED_UP") {
                const o = await tx.order.findUniqueOrThrow({
                    where: { id: d.orderId },
                });
                if (o.status !== "READY_FOR_PICKUP")
                    throw new ConflictException(
                        this.i18n.translate("delivery.errors.orderNotReadyYet"),
                    );
                await this.orders.deliveryMark(
                    tx,
                    d.orderId,
                    "OUT_FOR_DELIVERY",
                    partnerId,
                );
            }
        });
        return { success: true };
    }
    /** Customer shows a 4-digit handover code; partner submits it (max 5 tries). */
    async complete(
        partnerId: bigint,
        id: bigint,
        code: string,
        cashCollected?: number,
        proofMediaId?: number,
    ) {
        const d = await this.own(partnerId, id);
        if (!["PICKED_UP", "REACHED_CUSTOMER"].includes(d.status))
            throw new ConflictException(
                this.i18n.translate("delivery.errors.notOutForDelivery"),
            );
        const tries = await this.redis.client.incr(`hand:try:${id}`);
        await this.redis.client.expire(`hand:try:${id}`, 3600);
        if (tries > 5)
            throw new ForbiddenException(
                this.i18n.translate("delivery.errors.tooManyWrongCodes"),
            );
        if (sha256(`${d.orderId}:${code}`) !== d.handoverCodeHash)
            throw new BadRequestException({
                message: this.i18n.translate(
                    "delivery.errors.wrongHandoverCode",
                ),
                code: "BAD_CODE",
            });
        const order = await this.prisma.order.findUniqueOrThrow({
            where: { id: d.orderId },
        });
        const cod = d.cashToCollect != null ? num(d.cashToCollect) : 0;
        if (cod > 0 && (cashCollected ?? 0) < cod)
            throw new BadRequestException({
                message: this.i18n.translate("delivery.errors.cashRequired", {
                    args: { amount: this.currency.format(cod).formatted },
                }),
                code: "CASH_REQUIRED",
            });
        await this.prisma.$transaction(async (tx) => {
            const u = await tx.delivery.updateMany({
                where: { id, status: d.status },
                data: {
                    status: "DELIVERED",
                    deliveredAt: new Date(),
                    cashCollected: cod > 0 ? cashCollected : null,
                    proofMediaId: proofMediaId ? BigInt(proofMediaId) : null,
                },
            });
            if (!u.count)
                throw new ConflictException(
                    this.i18n.translate("delivery.errors.alreadyCompleted"),
                );
            await this.orders.deliveryMark(
                tx,
                d.orderId,
                "DELIVERED",
                partnerId,
            );
            if (cod > 0) {
                await tx.order.update({
                    where: { id: d.orderId },
                    data: { paymentStatus: "PAID" },
                });
                await tx.transaction.create({
                    data: {
                        txnNumber: docNumber("COD"),
                        orderId: d.orderId,
                        userId: order.userId,
                        type: "COD_COLLECTION",
                        method: "COD",
                        amount: cod,
                        status: "SUCCESS",
                        completedAt: new Date(),
                    },
                });
            }
            await tx.deliveryPartnerProfile.update({
                where: { userId: partnerId },
                data: { activeOrderCount: { decrement: 1 } },
            });
        });
        await this.redis.del(
            `handover:${d.orderId}`,
            `loc:order:${d.orderId}`,
            `hand:try:${id}`,
        );
        await this.redis.client.srem(
            `partner:orders:${partnerId}`,
            d.orderId.toString(),
        );
        await this.notify.notify(
            order.userId,
            "ORDER_STATUS",
            this.i18n.translate("delivery.notification.delivered.title", {
                lang: await this.languageOf(order.userId),
            }),
            this.i18n.translate("delivery.notification.delivered.body", {
                lang: await this.languageOf(order.userId),
                args: { orderNumber: order.orderNumber },
            }),
            { orderId: d.orderId.toString(), status: "DELIVERED" },
        );
        return { success: true };
    }

    // ===================== manager views =====================
    availablePartners(storeId: bigint) {
        return this.prisma.deliveryPartnerProfile.findMany({
            where: {
                isOnline: true,
                kycStatus: "VERIFIED",
                user: { storeId, status: "ACTIVE", approvalStatus: "APPROVED" },
            },
            select: {
                userId: true,
                isAvailable: true,
                activeOrderCount: true,
                lastLatitude: true,
                lastLongitude: true,
                lastLocationAt: true,
                vehicleType: true,
                user: { select: { name: true, phone: true } },
            },
        });
    }
    async liveMap(storeId: bigint) {
        const members = (await this.redis.client.zrange(
            geoKey(storeId),
            0,
            -1,
        )) as string[];
        if (!members.length) return [];
        const pos = await this.redis.client.geopos(geoKey(storeId), ...members);
        return members.map((m, i) => ({
            partnerId: m,
            lng: pos[i] ? +pos[i]![0] : null,
            lat: pos[i] ? +pos[i]![1] : null,
        }));
    }
}
