import { isWithinOpeningHours } from "@modules/stores/stores.util";
import { PageQueryDto } from "@common/dto/page-query.dto";
import { EventBus } from "@common/events/events";
import { AuthUser } from "@common/types/auth.type";
import {
    docNumber,
    money,
    num,
    orderNumber,
    pageParams,
} from "@common/utils/helpers.util";
import { AppConfig } from "@config/config.type";
import { CurrencyService } from "@core/currency/currency.service";
import { PrismaService } from "@core/database/prisma.service";
import { LocaleService } from "@core/locale/locale.service";
import { RedisService } from "@core/redis/redis.service";
import { CartService } from "@modules/cart/cart.service";
import { PricingService } from "@modules/cart/pricing.service";
import { MediaService } from "@modules/media/media.service";
import {
    NotificationsService,
} from "@modules/notifications/notifications.service";
import { CouponsService } from "./coupons.service";
import {
    AdminOrderListInput,
    CheckoutInput,
    PackInput,
    StoreOrderListInput,
} from "./orders.types";
import { PaymentsService } from "@modules/payments/payments.service";
import { StoresService } from "@modules/stores/stores.service";
import {
    BadRequestException,
    ConflictException,
    Injectable,
    Logger,
    NotFoundException,
    UnprocessableEntityException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Cron, CronExpression } from "@nestjs/schedule";
import { Prisma } from "@prisma-client/client";
import { OrderStatus, UserRole } from "@prisma-client/enums";
import { I18nService } from "nestjs-i18n";
import { StockService } from "@modules/inventory/stock.service";
export type Tx = Prisma.TransactionClient;

const STORE_TRANSITIONS: Record<string, OrderStatus[]> = {
    PLACED: ["ACCEPTED", "REJECTED"],
    ACCEPTED: ["PACKING", "CANCELLED"],
    PACKING: ["READY_FOR_PICKUP", "CANCELLED"],
    READY_FOR_PICKUP: ["CANCELLED"],
};
@Injectable()
export class OrdersService {
    private readonly log = new Logger("Orders");
    private readonly orderConfig: AppConfig["orders"];

    constructor(
        private readonly prisma: PrismaService,
        private readonly redis: RedisService,
        private readonly pricing: PricingService,
        private readonly stock: StockService,
        private readonly carts: CartService,
        private readonly coupons: CouponsService,
        private readonly stores: StoresService,
        private readonly pay: PaymentsService,
        private readonly notify: NotificationsService,
        private readonly media: MediaService,
        private readonly bus: EventBus,
        private readonly i18n: I18nService,
        private readonly locale: LocaleService,
        private readonly currency: CurrencyService,
        private readonly config: ConfigService,
    ) {
        this.orderConfig = config.getOrThrow<AppConfig["orders"]>("orders");
    }

    /** Largest order total payable by cash on delivery (`ORDER_COD_MAX_AMOUNT`). */
    private get paymentGateway(): string {
        return this.config.getOrThrow<string>("payment.gateway");
    }

    private get codMaxAmount(): number {
        return this.orderConfig.codMaxAmount;
    }

    /**
     * Timeline / notification title for a status.
     * Defaults to the platform default language because the title is stored
     * with the order event; pass `lang` for per-recipient notifications.
     */
    /** Preferred language of a user (falls back to the default language). */
    private async languageOf(userId: bigint): Promise<string> {
        const user = await this.prisma.user.findUnique({
            where: { id: userId },
            select: { language: true },
        });

        return this.locale.resolve(user?.language);
    }

    private eventTitle(status: OrderStatus, lang?: string): string {
        return this.i18n.translate(`orders.notification.title.${status}`, {
            lang: lang ?? this.locale.defaultLanguage,
        });
    }

    // ======================== CHECKOUT ========================
    async checkout(user: AuthUser, dto: CheckoutInput, lang: string) {
        if (dto.idempotencyKey) {
            const dup = await this.prisma.order.findUnique({
                where: { idempotencyKey: dto.idempotencyKey },
            });
            if (dup) {
                return { order: this.formatOrderMoney(dup), duplicate: true };
            }
        }
        const cart = await this.prisma.cart.findUnique({
            where: { userId: user.id },
            include: { items: true },
        });
        if (!cart || !cart.items.length || !cart.storeId)
            throw new BadRequestException(
                this.i18n.translate("orders.errors.cartEmpty"),
            );
        const [store, address, customer] = await Promise.all([
            this.prisma.store.findUniqueOrThrow({
                where: { id: cart.storeId },
            }),
            this.prisma.address.findFirst({
                where: { id: BigInt(dto.addressId), userId: user.id },
            }),
            this.prisma.user.findUniqueOrThrow({
                where: { id: user.id },
                select: { name: true, phone: true, walletBalance: true },
            }),
        ]);
        if (!address)
            throw new NotFoundException(
                this.i18n.translate("orders.errors.addressNotFound"),
            );
        if (
            store.status !== "ACTIVE" ||
            !store.isOpen ||
            !store.acceptingOrders ||
            !isWithinOpeningHours(store.openingHours, store.timezone)
        )
            throw new UnprocessableEntityException({
                message: this.i18n.translate("orders.errors.storeClosed"),
                code: "STORE_CLOSED",
            });
        if (
            !(await this.stores.serves(
                store.id,
                num(address.latitude),
                num(address.longitude),
            ))
        )
            throw new UnprocessableEntityException({
                message: this.i18n.translate("orders.errors.notServiceable"),
                code: "NOT_SERVICEABLE",
            });

        const lines = await this.pricing.price(cart.items, store.id, lang);
        const bad = lines.filter((l) => !l.ok);
        if (bad.length)
            throw new UnprocessableEntityException({
                message: this.i18n.translate("orders.errors.cartInvalid"),
                code: "CART_INVALID",
                items: bad.map((b) => ({
                    cartItemId: b.cartItemId,
                    issue: b.issue,
                    available: b.available,
                })),
            });
        const subtotal = money(lines.reduce((s, l) => s + l.lineTotal, 0));
        if (subtotal < num(store.minOrderValue))
            throw new UnprocessableEntityException({
                message: this.i18n.translate("orders.errors.minOrder", {
                    args: {
                        amount: this.currency.format(store.minOrderValue)
                            .formatted,
                    },
                }),
                code: "MIN_ORDER",
            });

        let discount = 0,
            freeDelivery = false,
            coupon:
                | Awaited<ReturnType<CouponsService["validate"]>>["coupon"]
                | null = null;
        if (cart.couponCode) {
            const r = await this.coupons.validate(
                cart.couponCode,
                user.id,
                store.id,
                subtotal,
            );
            discount = r.discount;
            freeDelivery = r.freeDelivery;
            coupon = r.coupon;
        }
        const fees = this.pricing.fees(store, subtotal, freeDelivery);
        const tip = money(dto.tip ?? 0);
        const raw =
            subtotal - discount + fees.deliveryFee + fees.handlingFee + tip;
        const total = Math.round(raw),
            roundOff = money(total - raw);
        const taxTotal = money(lines.reduce((s, l) => s + l.taxAmount, 0));

        if (dto.paymentMethod === "COD" && total > this.codMaxAmount)
            throw new BadRequestException({
                message: this.i18n.translate("orders.errors.codLimit", {
                    args: {
                        amount: this.currency.format(this.codMaxAmount)
                            .formatted,
                    },
                }),
                code: "COD_LIMIT",
            });
        const walletUse =
            dto.useWallet || dto.paymentMethod === "WALLET"
                ? Math.min(num(customer.walletBalance), total)
                : 0;
        if (dto.paymentMethod === "WALLET" && walletUse < total)
            throw new BadRequestException({
                message: this.i18n.translate("orders.errors.walletLow"),
                code: "WALLET_LOW",
            });
        const remaining = money(total - walletUse);
        const online =
            remaining > 0 && !["COD", "CASH"].includes(dto.paymentMethod);
        const method = remaining === 0 ? "WALLET" : dto.paymentMethod;
        const status: OrderStatus = online ? "PENDING_PAYMENT" : "PLACED";

        const order = await this.prisma.$transaction(
            async (tx) => {
                const o = await tx.order.create({
                    data: {
                        orderNumber: orderNumber(),
                        userId: user.id,
                        storeId: store.id,
                        status,
                        paymentMethod: method,
                        paymentStatus: remaining === 0 ? "PAID" : "PENDING",
                        customerName: address.receiverName || customer.name,
                        customerPhone: address.receiverPhone,
                        addressId: address.id,
                        deliveryAddress: {
                            line1: address.line1,
                            line2: address.line2,
                            landmark: address.landmark,
                            city: address.city,
                            state: address.state,
                            pincode: address.pincode,
                            label: address.label,
                        },
                        deliveryLat: address.latitude,
                        deliveryLng: address.longitude,
                        instructions: dto.instructions,
                        subtotal,
                        discountTotal: discount,
                        deliveryFee: fees.deliveryFee,
                        handlingFee: fees.handlingFee,
                        taxTotal,
                        tip,
                        roundOff,
                        total,
                        walletAmountUsed: walletUse,
                        couponId: coupon?.id,
                        couponCode: coupon?.code,
                        idempotencyKey: dto.idempotencyKey,
                        paymentExpiresAt: online
                            ? new Date(
                                  Date.now() +
                                      this.orderConfig.paymentWindowMinutes *
                                          60_000,
                              )
                            : null,
                        estimatedAt: new Date(
                            Date.now() +
                                (store.avgPrepMinutes +
                                    this.orderConfig.etaBufferMinutes) *
                                    60_000,
                        ),
                        events: {
                            create: { status, title: this.eventTitle(status) },
                        },
                    },
                });
                const need = new Map<string, { spId: bigint; qty: number }>();
                const addNeed = (spId: bigint, q: number) => {
                    const k = spId.toString();
                    need.set(k, { spId, qty: (need.get(k)?.qty ?? 0) + q });
                };
                const flashUnits = new Map<bigint, number>();
                for (const l of lines) {
                    const img = (c: (typeof l.components)[number]) =>
                        c.imageKey;
                    if (l.kind === "variant") {
                        const c = l.components[0];
                        addNeed(c.storeProductId, l.quantity);
                        if (c.flash) flashUnits.set(c.storeProductId, (flashUnits.get(c.storeProductId) ?? 0) + l.quantity);
                        await tx.orderItem.create({
                            data: {
                                orderId: o.id,
                                variantId: c.variantId,
                                productId: c.productId,
                                storeProductId: c.storeProductId,
                                title: c.title,
                                variantLabel: c.variantLabel,
                                sku: c.sku,
                                hsnCode: c.hsnCode,
                                imageKey: img(c),
                                mrp: c.mrp,
                                unitPrice: c.unitPrice,
                                quantity: l.quantity,
                                taxRate: c.taxRate,
                                taxAmount: l.taxAmount,
                                lineTotal: l.lineTotal,
                            },
                        });
                    } else {
                        const parent = await tx.orderItem.create({
                            data: {
                                orderId: o.id,
                                bundleId: l.bundleId,
                                title: l.titleMap,
                                mrp: l.mrp,
                                unitPrice: l.unitPrice,
                                quantity: l.quantity,
                                taxAmount: l.taxAmount,
                                lineTotal: l.lineTotal,
                            },
                        });
                        for (const c of l.components) {
                            addNeed(c.storeProductId, c.quantity * l.quantity);
                            await tx.orderItem.create({
                                data: {
                                    orderId: o.id,
                                    parentId: parent.id,
                                    variantId: c.variantId,
                                    productId: c.productId,
                                    storeProductId: c.storeProductId,
                                    title: c.title,
                                    variantLabel: c.variantLabel,
                                    sku: c.sku,
                                    hsnCode: c.hsnCode,
                                    imageKey: img(c),
                                    mrp: c.mrp,
                                    unitPrice: c.unitPrice,
                                    quantity: c.quantity * l.quantity,
                                    taxRate: c.taxRate,
                                    lineTotal: 0,
                                },
                            });
                        }
                    }
                }
                // atomic reservation, deterministic order => no deadlocks
                for (const { spId, qty } of [...need.values()].sort((a, b) =>
                    a.spId < b.spId ? -1 : 1,
                )) {
                    if (!(await this.stock.reserve(tx, spId, qty)))
                        throw new ConflictException({
                            message: this.i18n.translate(
                                "orders.errors.outOfStock",
                            ),
                            code: "OUT_OF_STOCK",
                        });
                    const sp = await tx.storeProduct.findUniqueOrThrow({
                        where: { id: spId },
                        select: { availableQty: true },
                    });
                    await this.stock.movement(tx, {
                        storeId: store.id,
                        storeProductId: spId,
                        type: "RESERVE",
                        quantity: -qty,
                        balanceAfter: sp.availableQty,
                        refType: "ORDER",
                        refId: o.id,
                    });
                }
                // Flash deals: take units from the flash quota atomically (no overselling the deal).
                for (const [spId, qty] of flashUnits) {
                    const n = await tx.$executeRaw`
                        UPDATE "StoreProduct" SET "flashSoldQty" = "flashSoldQty" + ${qty}
                        WHERE id = ${spId} AND "flashEndsAt" > now()
                          AND ("flashQtyLimit" IS NULL OR "flashSoldQty" + ${qty} <= "flashQtyLimit")`;
                    if (n !== 1)
                        throw new ConflictException({
                            message: this.i18n.translate("inventory.errors.flashSoldOut"),
                            code: "FLASH_SOLD_OUT",
                        });
                }
                if (coupon) {
                    const n =
                        await tx.$executeRaw`UPDATE "Coupon" SET "usedCount" = "usedCount" + 1 WHERE id = ${coupon.id} AND ("usageLimit" IS NULL OR "usedCount" < "usageLimit")`;
                    if (n !== 1)
                        throw new BadRequestException({
                            message: this.i18n.translate(
                                "coupons.errors.fullyRedeemed",
                            ),
                            code: "COUPON_INVALID",
                        });
                }
                if (
                    walletUse > 0 &&
                    !(await this.pay.walletDebit(
                        tx,
                        user.id,
                        walletUse,
                        "ORDER_PAYMENT",
                        o.id,
                    ))
                )
                    throw new BadRequestException({
                        message: this.i18n.translate("orders.errors.walletLow"),
                        code: "WALLET_LOW",
                    });
                return o;
            },
            { timeout: 20000, isolationLevel: "ReadCommitted" },
        );

        await this.carts.deleteCartAfterOrder(user.id);
        let payment: any = null;
        if (online) {
            const g = await this.pay.createGatewayOrder(
                order.orderNumber,
                remaining,
            );
            await this.prisma.transaction.create({
                data: {
                    txnNumber: docNumber("TX"),
                    orderId: order.id,
                    userId: user.id,
                    type: "PAYMENT",
                    method,
                    gateway: this.paymentGateway,
                    gatewayOrderId: g.gatewayOrderId,
                    amount: remaining,
                    status: "PENDING",
                },
            });
            payment = { ...g, expiresAt: order.paymentExpiresAt };
        } else await this.onPlaced(order.id, store.id);
        return { order: this.formatOrderMoney(order), payment };
    }
    private async onPlaced(orderId: bigint, storeId: bigint) {
        const mgrs = await this.prisma.user.findMany({
            where: {
                storeId,
                role: { in: ["STORE_MANAGER", "STORE_STAFF"] },
                status: "ACTIVE",
                approvalStatus: "APPROVED",
            },
            select: { id: true, language: true },
            take: 20,
        });

        // Each recipient is notified in their own language.
        await Promise.all(
            mgrs.map((manager) => {
                const lang = this.locale.resolve(manager.language);

                return this.notify.notify(
                    manager.id,
                    "ORDER_NEW",
                    this.i18n.translate("orders.notification.newOrder.title", {
                        lang,
                    }),
                    this.i18n.translate("orders.notification.newOrder.body", {
                        lang,
                    }),
                    { orderId: orderId.toString() },
                );
            }),
        );
    }

    // ======================== READ ========================
    private orderInclude = {
        items: {
            where: { parentId: null },
            orderBy: { id: "asc" as const },
            include: { children: true },
        },
        events: { orderBy: { id: "asc" as const } },
    } satisfies Prisma.OrderInclude;
    /** Order-level amounts as `{ amount, currency, symbol, formatted }`. */
    private formatOrderMoney<T extends Record<string, any>>(order: T) {
        const fields = [
            "subtotal",
            "discountTotal",
            "deliveryFee",
            "handlingFee",
            "taxTotal",
            "tip",
            "roundOff",
            "total",
            "walletAmountUsed",
        ];
        const formatted: Record<string, unknown> = {
            ...order,
            currency: this.currency.info,
        };

        for (const field of fields) {
            if (field in order) {
                formatted[field] = this.currency.format(order[field]);
            }
        }

        return formatted;
    }

    /** Adds image URLs and currency-aware prices to an order with items. */
    private withUrls(order: any) {
        const mapItem = (item: any) => ({
            ...item,
            imageUrl: this.media.urlForKey(item.imageKey),
            mrp: this.currency.format(item.mrp),
            unitPrice: this.currency.format(item.unitPrice),
            taxAmount: this.currency.format(item.taxAmount),
            lineTotal: this.currency.format(item.lineTotal),
            children: item.children?.map(mapItem),
        });

        return {
            ...this.formatOrderMoney(order),
            items: order.items.map(mapItem),
        };
    }

    async customerList(userId: bigint, query: PageQueryDto) {
        const { take, skip } = pageParams(query);
        const orders = await this.prisma.order.findMany({
            where: { userId },
            orderBy: { id: "desc" },
            take,
            skip,
            select: {
                id: true,
                orderNumber: true,
                status: true,
                paymentStatus: true,
                total: true,
                placedAt: true,
                storeId: true,
                _count: { select: { items: true } },
            },
        });

        return {
            currency: this.currency.info,
            items: orders.map((order) => ({
                ...order,
                total: this.currency.format(order.total),
            })),
        };
    }
    async customerGet(userId: bigint, id: bigint) {
        const o = await this.prisma.order.findFirst({
            where: { id, userId },
            include: {
                ...this.orderInclude,
                store: {
                    select: {
                        name: true,
                        phone: true,
                        latitude: true,
                        longitude: true,
                    },
                },
            },
        });
        if (!o)
            throw new NotFoundException(
                this.i18n.translate("orders.errors.notFound"),
            );
        return this.withUrls(o);
    }
    /** Timeline + live partner position (Redis) + handover OTP for the customer. */
    async track(userId: bigint, id: bigint) {
        const o = await this.prisma.order.findFirst({
            where: { id, userId },
            select: {
                id: true,
                status: true,
                estimatedAt: true,
                deliveryLat: true,
                deliveryLng: true,
                deliveryPartnerId: true,
                events: {
                    orderBy: { id: "asc" },
                    select: { status: true, title: true, createdAt: true },
                },
                store: { select: { latitude: true, longitude: true } },
            },
        });
        if (!o)
            throw new NotFoundException(
                this.i18n.translate("orders.errors.notFound"),
            );
        const live =
            o.status === OrderStatus.OUT_FOR_DELIVERY ||
            o.status === OrderStatus.READY_FOR_PICKUP
                ? await this.redis.getJson<any>(`loc:order:${id}`)
                : null;
        const partner = o.deliveryPartnerId
            ? await this.prisma.user.findUnique({
                  where: { id: o.deliveryPartnerId },
                  select: {
                      name: true,
                      phone: true,
                      partnerProfile: {
                          select: { vehicleType: true, vehicleNumber: true },
                      },
                  },
              })
            : null;
        const handoverCode =
            o.status === OrderStatus.OUT_FOR_DELIVERY
                ? await this.redis.client.get(`handover:${id}`)
                : null;
        return {
            status: o.status,
            estimatedAt: o.estimatedAt,
            timeline: o.events,
            destination: { lat: o.deliveryLat, lng: o.deliveryLng },
            store: o.store,
            partner,
            partnerLocation: live,
            handoverCode,
        };
    }
    async storeList(storeId: bigint, query: StoreOrderListInput) {
        const { take, skip } = pageParams(query);
        const where: Prisma.OrderWhereInput = {
            storeId,
            ...(query.status?.length ? { status: { in: query.status } } : {}),
        };
        const [items, total] = await Promise.all([
            this.prisma.order.findMany({
                where,
                orderBy: { id: "desc" },
                take,
                skip,
                select: {
                    id: true,
                    orderNumber: true,
                    status: true,
                    paymentMethod: true,
                    paymentStatus: true,
                    total: true,
                    placedAt: true,
                    customerName: true,
                    deliveryPartnerId: true,
                    _count: { select: { items: true } },
                },
            }),
            this.prisma.order.count({ where }),
        ]);
        return {
            currency: this.currency.info,
            items: items.map((order) => ({
                ...order,
                total: this.currency.format(order.total),
            })),
            total,
        };
    }
    async storeGet(storeId: bigint | null, id: bigint) {
        const o = await this.prisma.order.findFirst({
            where: { id, ...(storeId ? { storeId } : {}) },
            include: {
                items: { orderBy: { id: "asc" }, include: { batches: true } },
                events: { orderBy: { id: "asc" } },
                deliveries: { orderBy: { id: "desc" }, take: 3 },
            },
        });
        if (!o)
            throw new NotFoundException(
                this.i18n.translate("orders.errors.notFound"),
            );
        return {
            ...o,
            items: o.items.map((i) => ({
                ...i,
                imageUrl: this.media.urlForKey(i.imageKey),
            })),
        };
    }
    async adminList(query: AdminOrderListInput) {
        const { take, skip, page, limit } = pageParams(query);
        const where: Prisma.OrderWhereInput = {
            ...(query.storeId ? { storeId: BigInt(query.storeId) } : {}),
            ...(query.status ? { status: query.status } : {}),
            ...(query.from || query.to
                ? {
                      placedAt: {
                          ...(query.from ? { gte: new Date(query.from) } : {}),
                          ...(query.to ? { lte: new Date(query.to) } : {}),
                      },
                  }
                : {}),
            ...(query.q
                ? {
                      OR: [
                          {
                              orderNumber: {
                                  contains: query.q,
                                  mode: "insensitive",
                              },
                          },
                          {
                              customerPhone: {
                                  contains: query.q,
                                  mode: "insensitive",
                              },
                          },
                      ],
                  }
                : {}),
        };
        const orderBy =
            query.sort === "oldest"
                ? { id: "asc" as const }
                : query.sort === "total_desc"
                  ? { total: "desc" as const }
                  : query.sort === "total_asc"
                    ? { total: "asc" as const }
                    : { id: "desc" as const };

        const [orders, total] = await Promise.all([
            this.prisma.order.findMany({
                where,
                orderBy,
                take,
                skip,
            }),
            this.prisma.order.count({ where }),
        ]);

        return {
            currency: this.currency.info,
            items: orders.map((order) => this.formatOrderMoney(order)),
            total,
            page,
            limit,
        };
    }

    async adminTransition(
        user: AuthUser,
        orderId: bigint,
        to: OrderStatus,
        reason?: string,
    ) {
        const order = await this.prisma.order.findUnique({
            where: { id: orderId },
            select: { id: true, storeId: true },
        });
        if (!order)
            throw new NotFoundException(
                this.i18n.translate("orders.errors.notFound"),
            );
        return this.storeTransition(
            { ...user, storeId: order.storeId },
            orderId,
            to,
            reason,
        );
    }

    // ======================== STATE CHANGES ========================
    private async setStatus(
        tx: Tx,
        orderId: bigint,
        status: OrderStatus,
        actor?: { id: bigint; role: UserRole },
        note?: string,
        extra: Prisma.OrderUncheckedUpdateInput = {},
    ) {
        await tx.order.update({
            where: { id: orderId },
            data: { status, ...extra },
        });
        await tx.orderEvent.create({
            data: {
                orderId,
                status,
                title: this.eventTitle(status),
                note,
                actorId: actor?.id,
                actorRole: actor?.role,
            },
        });
    }

    /** Store-side transitions (staff / manager). */
    async storeTransition(
        user: AuthUser,
        orderId: bigint,
        to: OrderStatus,
        reason?: string,
    ) {
        const o = await this.prisma.order.findFirst({
            where: { id: orderId, storeId: user.storeId! },
        });
        if (!o)
            throw new NotFoundException(
                this.i18n.translate("orders.errors.notFound"),
            );
        if (!STORE_TRANSITIONS[o.status]?.includes(to))
            throw new ConflictException(
                this.i18n.translate("orders.errors.invalidTransition", {
                    args: { from: o.status, to },
                }),
            );
        if ((to === "REJECTED" || to === "CANCELLED") && !reason)
            throw new BadRequestException(
                this.i18n.translate("orders.errors.reasonRequired"),
            );
        if (to === "READY_FOR_PICKUP") {
            const leaf = await this.prisma.orderItem.findMany({
                where: { orderId, variantId: { not: null } },
                select: { quantity: true, pickedQty: true, pickStatus: true },
            });
            if (
                leaf.some(
                    (i) =>
                        i.pickedQty < i.quantity &&
                        i.pickStatus !== "OUT_OF_STOCK",
                )
            )
                throw new ConflictException({
                    message: this.i18n.translate(
                        "orders.errors.packingIncomplete",
                    ),
                    code: "PACKING_INCOMPLETE",
                });
        }
        if (to === "REJECTED" || to === "CANCELLED")
            return this.cancelInternal(o.id, user, reason!, to);
        await this.prisma.$transaction((tx) =>
            this.setStatus(
                tx,
                o.id,
                to,
                user,
                reason,
                to === "ACCEPTED"
                    ? { acceptedAt: new Date(), pickerId: user.id }
                    : to === "READY_FOR_PICKUP"
                      ? { packedAt: new Date(), packedById: user.id }
                      : {},
            ),
        );
        if (to === "READY_FOR_PICKUP")
            this.bus.emit({
                type: "order.ready",
                orderId: o.id,
                storeId: o.storeId,
            });
        const lang = await this.languageOf(o.userId);

        await this.notify.notify(
            o.userId,
            "ORDER_STATUS",
            this.eventTitle(to, lang),
            this.i18n.translate("orders.notification.orderRef", {
                lang,
                args: { orderNumber: o.orderNumber },
            }),
            { orderId: o.id.toString(), status: to },
        );
        return { success: true };
    }

    async customerCancel(userId: bigint, orderId: bigint, reason?: string) {
        const o = await this.prisma.order.findFirst({
            where: { id: orderId, userId },
        });
        if (!o)
            throw new NotFoundException(
                this.i18n.translate("orders.errors.notFound"),
            );
        if (!["PENDING_PAYMENT", "PLACED", "ACCEPTED"].includes(o.status))
            throw new ConflictException({
                message: this.i18n.translate("orders.errors.cancelNotAllowed"),
                code: "CANCEL_NOT_ALLOWED",
            });
        return this.cancelInternal(
            o.id,
            { id: userId, role: "CUSTOMER" },
            reason ?? this.i18n.translate("orders.reasons.cancelledByCustomer"),
            "CANCELLED",
        );
    }

    /** Releases reservations, restocks already-packed batches, reverses coupon, refunds money. Idempotent via status guard. */
    private async cancelInternal(
        orderId: bigint,
        actor: { id: bigint; role: UserRole },
        reason: string,
        to: "CANCELLED" | "REJECTED" | "FAILED",
    ) {
        const res = await this.prisma.$transaction(async (tx) => {
            const claimed = await tx.order.updateMany({
                where: {
                    id: orderId,
                    status: {
                        in: [
                            "PENDING_PAYMENT",
                            "PLACED",
                            "ACCEPTED",
                            "PACKING",
                            "READY_FOR_PICKUP",
                        ],
                    },
                },
                data: {
                    status: to,
                    cancelledAt: new Date(),
                    cancelledByRole: actor.role,
                    cancelReason: reason.slice(0, 255),
                },
            });
            if (claimed.count !== 1) return null;
            const o = await tx.order.findUniqueOrThrow({
                where: { id: orderId },
            });
            await tx.orderEvent.create({
                data: {
                    orderId,
                    status: to,
                    title: this.eventTitle(to),
                    note: reason.slice(0, 255),
                    actorId: actor.id,
                    actorRole: actor.role,
                },
            });
            const items = await tx.orderItem.findMany({
                where: {
                    orderId,
                    variantId: { not: null },
                    storeProductId: { not: null },
                },
                include: { batches: true },
            });
            for (const it of items) {
                const unpicked = it.quantity - it.pickedQty;
                if (unpicked > 0 && it.pickStatus !== "OUT_OF_STOCK") {
                    await this.stock.release(tx, it.storeProductId!, unpicked);
                    const sp = await tx.storeProduct.findUnique({
                        where: { id: it.storeProductId! },
                        select: { availableQty: true },
                    });
                    await this.stock.movement(tx, {
                        storeId: o.storeId,
                        storeProductId: it.storeProductId!,
                        type: "RELEASE",
                        quantity: unpicked,
                        balanceAfter: sp?.availableQty ?? 0,
                        orderItemId: it.id,
                        refType: "ORDER",
                        refId: orderId,
                    });
                }
                for (const b of it.batches) {
                    // already packed -> back to the ORIGINAL batch
                    const batch = await tx.inventoryBatch.update({
                        where: { id: b.batchId },
                        data: {
                            availableQty: { increment: b.quantity },
                            ...(await this.reviveStatus(tx, b.batchId)),
                        },
                    });
                    const bal =
                        batch.status === "ACTIVE"
                            ? await this.stock.bumpAvailable(
                                  tx,
                                  it.storeProductId!,
                                  b.quantity,
                              )
                            : (
                                  await tx.storeProduct.findUniqueOrThrow({
                                      where: { id: it.storeProductId! },
                                  })
                              ).availableQty;
                    await this.stock.movement(tx, {
                        storeId: o.storeId,
                        storeProductId: it.storeProductId!,
                        batchId: b.batchId,
                        type: "RETURN",
                        quantity: b.quantity,
                        balanceAfter: bal,
                        batchBalanceAfter: batch.availableQty,
                        orderItemId: it.id,
                        refType: "ORDER",
                        refId: orderId,
                    });
                }
            }
            if (o.couponId)
                await tx.$executeRaw`UPDATE "Coupon" SET "usedCount" = GREATEST("usedCount" - 1, 0) WHERE id = ${o.couponId}`;
            await tx.delivery.updateMany({
                where: {
                    orderId,
                    status: { in: ["ASSIGNED", "ACCEPTED", "REACHED_STORE"] },
                },
                data: {
                    status: "CANCELLED",
                    cancelledAt: new Date(),
                    cancelReason: this.i18n.translate(
                        "orders.reasons.orderCancelled",
                        {
                            lang: this.locale.defaultLanguage,
                        },
                    ),
                },
            });
            return o;
        });
        if (!res)
            throw new ConflictException(
                this.i18n.translate("orders.errors.alreadyClosed"),
            );
        // refunds (outside tx; idempotent)
        if (res.paymentStatus === "PAID")
            await this.pay.refund(orderId, num(res.total), "cancel");
        else if (num(res.walletAmountUsed) > 0)
            await this.prisma.$transaction((tx) =>
                this.pay.walletCredit(
                    tx,
                    res.userId,
                    num(res.walletAmountUsed),
                    "REFUND",
                    orderId,
                    `refund:${orderId}:cancel-wallet`,
                ),
            );
        this.bus.emit({
            type: "order.cancelled",
            orderId,
            storeId: res.storeId,
        });
        await this.notify.notify(
            res.userId,
            "ORDER_STATUS",
            this.eventTitle(to, await this.languageOf(res.userId)),
            reason,
            { orderId: orderId.toString(), status: to },
        );
        return { success: true };
    }
    private async reviveStatus(tx: Tx, batchId: bigint) {
        const b = await tx.inventoryBatch.findUnique({
            where: { id: batchId },
            select: { status: true },
        });
        return b?.status === "DEPLETED" ? { status: "ACTIVE" as const } : {};
    }

    async rate(
        userId: bigint,
        orderId: bigint,
        d: { rating: number; deliveryRating?: number; note?: string },
    ) {
        const r = await this.prisma.order.updateMany({
            where: { id: orderId, userId, status: "DELIVERED", rating: null },
            data: {
                rating: d.rating,
                deliveryRating: d.deliveryRating,
                ratingNote: d.note,
            },
        });
        if (!r.count)
            throw new ConflictException(
                this.i18n.translate("orders.errors.cannotRate"),
            );
        return { success: true };
    }

    // ======================== PACKING (manual or barcode scan) ========================
    async pack(user: AuthUser, orderId: bigint, dto: PackInput) {
        if (!dto.barcode && !dto.orderItemId)
            throw new BadRequestException(
                this.i18n.translate("orders.errors.barcodeOrItemRequired"),
            );
        const order = await this.prisma.order.findFirst({
            where: { id: orderId, storeId: user.storeId! },
            include: { store: { select: { timezone: true } } },
        });
        if (!order)
            throw new NotFoundException(
                this.i18n.translate("orders.errors.notFound"),
            );
        if (!["ACCEPTED", "PACKING"].includes(order.status))
            throw new ConflictException(
                this.i18n.translate("orders.errors.cannotPack", {
                    args: { status: order.status },
                }),
            );
        const method = dto.barcode ? "SCAN" : "MANUAL";
        let variantId: bigint | undefined;
        if (dto.barcode) {
            const bc = await this.prisma.productBarcode.findUnique({
                where: { code: dto.barcode.trim() },
                select: { variantId: true },
            });
            if (!bc)
                throw new NotFoundException({
                    message: this.i18n.translate(
                        "orders.errors.unknownBarcode",
                    ),
                    code: "BARCODE_UNKNOWN",
                });
            variantId = bc.variantId;
        }
        const want = dto.quantity ?? 1;

        return this.prisma
            .$transaction(
                async (tx) => {
                    const item = await tx.orderItem.findFirst({
                        where: {
                            orderId,
                            variantId: variantId ?? { not: null },
                            ...(dto.orderItemId
                                ? { id: BigInt(dto.orderItemId) }
                                : {}),
                            pickStatus: { in: ["PENDING", "PARTIAL"] },
                        },
                        orderBy: { id: "asc" },
                    });
                    if (!item || !item.storeProductId)
                        throw new NotFoundException({
                            message: this.i18n.translate(
                                "orders.errors.itemNotPending",
                            ),
                            code: "ITEM_NOT_PENDING",
                        });
                    const remaining = item.quantity - item.pickedQty;
                    if (want > remaining)
                        throw new BadRequestException({
                            message: this.i18n.translate(
                                "orders.errors.overPick",
                                { args: { remaining } },
                            ),
                            code: "OVER_PICK",
                        });
                    const sp = await tx.storeProduct.findUniqueOrThrow({
                        where: { id: item.storeProductId },
                    });
                    const picks = sp.trackBatches
                        ? await this.stock.pickFefo(
                              tx,
                              sp.id,
                              want,
                              sp.minSellableDays,
                              order.store.timezone,
                          )
                        : [
                              {
                                  batchId: null as bigint | null,
                                  batchNumber: "",
                                  mrp: num(item.mrp),
                                  clearancePrice: null,
                                  manufacturedAt: null,
                                  expiryDate: null,
                                  take: want,
                              },
                          ];

                    // physical deduction: store qty + reserved, then each batch
                    const moved =
                        await tx.$executeRaw`UPDATE "StoreProduct" SET "availableQty" = "availableQty" - ${want}, "reservedQty" = "reservedQty" - ${want}, "updatedAt" = now() WHERE id = ${sp.id} AND "availableQty" >= ${want} AND "reservedQty" >= ${want}`;
                    if (moved !== 1)
                        throw new ConflictException(
                            this.i18n.translate("orders.errors.stockMismatch"),
                        );
                    let balance = sp.availableQty - want,
                        priceDrop = 0;
                    const groups = new Map<string, typeof picks>();
                    for (const p of picks)
                        groups.set(p.mrp.toFixed(2), [
                            ...(groups.get(p.mrp.toFixed(2)) ?? []),
                            p,
                        ]);
                    let first = true;
                    for (const [mrpKey, gp] of groups) {
                        const qty = gp.reduce((s, p) => s + p.take, 0),
                            mrp = +mrpKey;
                        let target = item;
                        if (
                            !first ||
                            (mrp !== num(item.mrp) && item.pickedQty > 0)
                        ) {
                            // Rule: one OrderItem = one MRP. Split the line when batches have different MRPs.
                            const unit = item.parentId
                                ? num(item.unitPrice)
                                : Math.min(num(item.unitPrice), mrp);
                            target = await tx.orderItem.create({
                                data: {
                                    orderId,
                                    parentId: item.parentId,
                                    variantId: item.variantId,
                                    productId: item.productId,
                                    storeProductId: item.storeProductId,
                                    title: item.title as any,
                                    variantLabel: item.variantLabel,
                                    sku: item.sku,
                                    hsnCode: item.hsnCode,
                                    imageKey: item.imageKey,
                                    mrp,
                                    unitPrice: unit,
                                    quantity: qty,
                                    taxRate: item.taxRate,
                                    taxAmount: item.parentId
                                        ? 0
                                        : this.pricing.taxIncluded(
                                              unit * qty,
                                              num(item.taxRate),
                                          ),
                                    lineTotal: item.parentId
                                        ? 0
                                        : money(unit * qty),
                                    pickedQty: 0,
                                    pickStatus: "PENDING",
                                },
                            });
                            await tx.orderItem.update({
                                where: { id: item.id },
                                data: {
                                    quantity: { decrement: qty },
                                    ...(item.parentId
                                        ? {}
                                        : {
                                              lineTotal: money(
                                                  num(item.unitPrice) *
                                                      (item.quantity - qty),
                                              ),
                                              taxAmount:
                                                  this.pricing.taxIncluded(
                                                      num(item.unitPrice) *
                                                          (item.quantity - qty),
                                                      num(item.taxRate),
                                                  ),
                                          }),
                                },
                            });
                        } else if (mrp !== num(item.mrp)) {
                            const unit = item.parentId
                                ? num(item.unitPrice)
                                : Math.min(num(item.unitPrice), mrp);
                            priceDrop += item.parentId
                                ? 0
                                : (num(item.unitPrice) - unit) * item.quantity;
                            await tx.orderItem.update({
                                where: { id: item.id },
                                data: {
                                    mrp,
                                    unitPrice: unit,
                                    ...(item.parentId
                                        ? {}
                                        : {
                                              lineTotal: money(
                                                  unit * item.quantity,
                                              ),
                                              taxAmount:
                                                  this.pricing.taxIncluded(
                                                      unit * item.quantity,
                                                      num(item.taxRate),
                                                  ),
                                          }),
                                },
                            });
                            target = {
                                ...item,
                                mrp: mrp as any,
                                unitPrice: unit as any,
                            };
                        }
                        if (target !== item) priceDrop += 0; // split lines already priced <= their own MRP
                        first = false;
                        for (const p of gp) {
                            let bBal: number | undefined;
                            if (p.batchId) {
                                const r = await tx.$queryRaw<
                                    { availableQty: number }[]
                                >`UPDATE "InventoryBatch" SET "availableQty" = "availableQty" - ${p.take}, "updatedAt" = now() WHERE id = ${p.batchId} AND "availableQty" >= ${p.take} RETURNING "availableQty"`;
                                if (!r.length)
                                    throw new ConflictException(
                                        this.i18n.translate(
                                            "orders.errors.batchStockChanged",
                                        ),
                                    );
                                bBal = r[0].availableQty;
                                if (bBal === 0)
                                    await tx.inventoryBatch.update({
                                        where: { id: p.batchId },
                                        data: { status: "DEPLETED" },
                                    });
                                await tx.orderItemBatch.create({
                                    data: {
                                        orderItemId: target.id,
                                        batchId: p.batchId,
                                        batchNumber: p.batchNumber,
                                        mrp: p.mrp,
                                        unitPrice: Math.min(
                                            num(target.unitPrice),
                                            p.mrp,
                                        ),
                                        manufacturedAt: p.manufacturedAt,
                                        expiryDate: p.expiryDate,
                                        quantity: p.take,
                                    },
                                });
                            }
                            await this.stock.movement(tx, {
                                storeId: order.storeId,
                                storeProductId: sp.id,
                                batchId: p.batchId,
                                type: "SALE",
                                quantity: -p.take,
                                balanceAfter: balance,
                                batchBalanceAfter: bBal,
                                orderItemId: target.id,
                                refType: "ORDER",
                                refId: orderId,
                                actorId: user.id,
                            });
                        }
                        const newPicked =
                            (target.id === item.id ? item.pickedQty : 0) + qty;
                        const tq =
                            target.id === item.id ? item.quantity - 0 : qty;
                        await tx.orderItem.update({
                            where: { id: target.id },
                            data: {
                                pickedQty: newPicked,
                                pickStatus:
                                    newPicked >=
                                    (target.id === item.id ? item.quantity : tq)
                                        ? "PICKED"
                                        : "PARTIAL",
                                pickMethod: method,
                                pickedById: user.id,
                                pickedAt: new Date(),
                            },
                        });
                    }
                    if (sp.trackBatches)
                        await this.stock.refreshMrp(
                            tx,
                            sp.id,
                            user.id,
                            order.store.timezone,
                        );
                    if (order.status === "ACCEPTED")
                        await this.setStatus(
                            tx,
                            orderId,
                            "PACKING",
                            user,
                            undefined,
                            { packingStartedAt: new Date(), pickerId: user.id },
                        );
                    if (priceDrop > 0)
                        await tx.order.update({
                            where: { id: orderId },
                            data: {
                                total: { decrement: money(priceDrop) },
                                subtotal: { decrement: money(priceDrop) },
                            },
                        });
                    const pending = await tx.orderItem.count({
                        where: {
                            orderId,
                            variantId: { not: null },
                            pickStatus: { in: ["PENDING", "PARTIAL"] },
                        },
                    });
                    return {
                        picked: want,
                        itemId: item.id,
                        remainingForItem: remaining - want,
                        allPacked: pending === 0,
                        priceDrop: money(priceDrop),
                    };
                },
                { timeout: 20000 },
            )
            .then(async (r) => {
                if (r.priceDrop > 0 && order.paymentStatus === "PAID")
                    await this.pay.refund(
                        orderId,
                        r.priceDrop,
                        `pricedrop:${r.itemId}:${Date.now()}`,
                    );
                return r;
            });
    }

    /** Item cannot be found on shelf: drop the unpicked part, release reservation, refund its price. */
    async markOutOfStock(user: AuthUser, orderId: bigint, itemId: bigint) {
        const order = await this.prisma.order.findFirst({
            where: { id: orderId, storeId: user.storeId! },
        });
        if (!order)
            throw new NotFoundException(
                this.i18n.translate("orders.errors.notFound"),
            );
        if (!["ACCEPTED", "PACKING"].includes(order.status))
            throw new ConflictException(
                this.i18n.translate("orders.errors.notBeingPacked"),
            );
        const refund = await this.prisma.$transaction(async (tx) => {
            const it = await tx.orderItem.findFirst({
                where: { id: itemId, orderId, variantId: { not: null } },
            });
            if (!it || !it.storeProductId)
                throw new NotFoundException(
                    this.i18n.translate("orders.errors.notFound"),
                );
            if (it.parentId)
                throw new BadRequestException(
                    this.i18n.translate("orders.errors.bundleComponentMissing"),
                );
            const removed = it.quantity - it.pickedQty;
            if (removed <= 0)
                throw new BadRequestException(
                    this.i18n.translate("orders.errors.nothingToRemove"),
                );
            await this.stock.release(tx, it.storeProductId, removed);
            const cut = money(num(it.unitPrice) * removed);
            const newQty = it.pickedQty,
                newLine = money(num(it.unitPrice) * newQty);
            await tx.orderItem.update({
                where: { id: it.id },
                data: {
                    quantity: newQty,
                    lineTotal: newLine,
                    taxAmount: this.pricing.taxIncluded(
                        newLine,
                        num(it.taxRate),
                    ),
                    pickStatus: "OUT_OF_STOCK",
                },
            });
            await tx.order.update({
                where: { id: orderId },
                data: {
                    subtotal: { decrement: cut },
                    total: { decrement: cut },
                    ...(order.status === "ACCEPTED" ? {} : {}),
                },
            });
            await tx.orderEvent.create({
                data: {
                    orderId,
                    status: order.status,
                    title: "Item removed (out of stock)",
                    actorId: user.id,
                    actorRole: user.role,
                },
            });
            return cut;
        });
        if (order.paymentStatus === "PAID")
            await this.pay.refund(orderId, refund, `oos:${itemId}`);
        return { removedAmount: refund };
    }

    // ======================== HOUSEKEEPING ========================
    /** Unpaid online orders: cancel after the payment window and give stock back. */
    @Cron(CronExpression.EVERY_MINUTE)
    async expireUnpaid() {
        const lock = await this.redis.lock("cron:unpaid", 55);
        if (!lock) return;
        try {
            const stale = await this.prisma.order.findMany({
                where: {
                    status: "PENDING_PAYMENT",
                    paymentExpiresAt: { lt: new Date() },
                },
                select: { id: true },
                take: 100,
            });
            for (const o of stale)
                await this.cancelInternal(
                    o.id,
                    { id: 0n, role: "ADMIN" },
                    this.i18n.translate("orders.reasons.paymentWindowExpired", {
                        lang: this.locale.defaultLanguage,
                    }),
                    "FAILED",
                ).catch((e) => this.log.warn(`expire ${o.id}: ${e.message}`));
        } finally {
            await lock();
        }
    }

    /** Used by delivery module. */
    async deliveryMark(
        tx: Tx,
        orderId: bigint,
        to: Extract<OrderStatus, "OUT_FOR_DELIVERY" | "DELIVERED">,
        partnerId: bigint,
    ) {
        await this.setStatus(
            tx,
            orderId,
            to,
            { id: partnerId, role: UserRole.DELIVERY_PARTNER },
            undefined,
            to === OrderStatus.DELIVERED
                ? { deliveredAt: new Date(), paymentStatus: undefined }
                : {},
        );
    }
}
