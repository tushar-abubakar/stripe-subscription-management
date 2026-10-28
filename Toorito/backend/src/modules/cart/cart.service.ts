import { money, randomToken } from "@common/utils/helpers.util";
import { AppConfig } from "@config/config.type";
import { CurrencyService } from "@core/currency/currency.service";
import { PrismaService } from "@core/database/prisma.service";
import { LocaleService } from "@core/locale/locale.service";
import { RedisService } from "@core/redis/redis.service";
import { PricingService } from "@modules/cart/pricing.service";
import {
    BadRequestException,
    ConflictException,
    HttpException,
    HttpStatus,
    Injectable,
    Logger,
    NotFoundException,
    UnprocessableEntityException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Cron, CronExpression } from "@nestjs/schedule";
import { I18nService } from "nestjs-i18n";

export interface CartActor {
    userId?: bigint;
    guestToken?: string;
}
export interface AddItemInput {
    variantId?: bigint;
    bundleId?: bigint;
    quantity: number;
    storeId: bigint;
    replaceStore?: boolean;
    /** Client IP; used to cap how many guest carts one network can create. */
    ip?: string;
}

@Injectable()
export class CartService {
    private readonly log = new Logger("Cart");
    private readonly guestMs: number;
    private readonly userMs: number;
    private readonly guestCartsPerIpPerHour: number;

    constructor(
        private readonly prisma: PrismaService,
        private readonly pricing: PricingService,
        private readonly redis: RedisService,
        private readonly i18n: I18nService,
        private readonly locale: LocaleService,
        private readonly currency: CurrencyService,
        config: ConfigService,
    ) {
        const cart = config.getOrThrow<AppConfig["cart"]>("cart");

        this.guestMs = cart.guestTtlHours * 3_600_000;
        this.userMs = cart.userTtlDays * 86_400_000;
        this.guestCartsPerIpPerHour = cart.guestCartsPerIpPerHour;
    }

    /**
     * Caps guest cart creation per IP (fixed one-hour window in Redis) so
     * bots cannot fill the Cart table with throw-away sessions.
     */
    private async assertGuestCartQuota(ip?: string): Promise<void> {
        if (!ip) {
            return;
        }

        const key = `cart:guest:new:${ip}`;
        const created = await this.redis.client.incr(key);

        if (created === 1) {
            await this.redis.client.expire(key, 3600);
        }

        if (created > this.guestCartsPerIpPerHour) {
            throw new HttpException(
                this.i18n.translate("cart.errors.tooManyGuestCarts"),
                HttpStatus.TOO_MANY_REQUESTS,
            );
        }
    }
    private expiry(a: CartActor) {
        return new Date(Date.now() + (a.userId ? this.userMs : this.guestMs));
    }

    private async find(a: CartActor) {
        if (a.userId)
            return this.prisma.cart.findUnique({ where: { userId: a.userId } });
        if (a.guestToken)
            return this.prisma.cart.findUnique({
                where: { guestToken: a.guestToken },
            });
        return null;
    }

    async view(a: CartActor, lang: string) {
        const cart = await this.find(a);
        if (!cart || cart.expiresAt < new Date())
            return {
                items: [],
                itemCount: 0,
                subtotal: this.currency.format(0),
                currency: this.currency.info,
                storeId: null,
            };
        const items = await this.prisma.cartItem.findMany({
            where: { cartId: cart.id },
            orderBy: { id: "asc" },
        });
        if (!cart.storeId)
            return {
                cartId: cart.id,
                storeId: null,
                items: [],
                itemCount: 0,
                subtotal: this.currency.format(0),
                currency: this.currency.info,
            };
        const store = await this.prisma.store.findUniqueOrThrow({
            where: { id: cart.storeId },
        });
        const lines = await this.pricing.price(items, cart.storeId, lang);
        const subtotal = money(
            lines.filter((l) => l.ok).reduce((s, l) => s + l.lineTotal, 0),
        );
        const fees = this.pricing.fees(store, subtotal);
        return {
            cartId: cart.id,
            storeId: cart.storeId,
            couponCode: cart.couponCode,
            currency: this.currency.info,
            // Every price carries amount + currency code + symbol.
            items: lines.map(
                ({ components, titleMap, bundleTitleMap, ...line }) => ({
                    ...line,
                    unitPrice: this.currency.format(line.unitPrice),
                    mrp: this.currency.format(line.mrp),
                    lineTotal: this.currency.format(line.lineTotal),
                    taxAmount: this.currency.format(line.taxAmount),
                }),
            ),
            itemCount: items.reduce((sum, item) => sum + item.quantity, 0),
            subtotal: this.currency.format(subtotal),
            deliveryFee: this.currency.format(fees.deliveryFee),
            handlingFee: this.currency.format(fees.handlingFee),
            /** Live store surcharges (already included in handlingFee). */
            surcharges: fees.surcharges.map((charge) => ({
                ...charge,
                label: charge.label ? this.locale.pick(charge.label, lang) : null,
                amount: this.currency.format(charge.amount),
            })),
            total: this.currency.format(
                subtotal + fees.deliveryFee + fees.handlingFee,
            ),
            minOrderValue: this.currency.format(store.minOrderValue),
            canCheckout:
                lines.length > 0 &&
                lines.every((l) => l.ok) &&
                subtotal >= Number(store.minOrderValue),
        };
    }

    /** Create a guest cart explicitly so clients can persist a token before adding their first item. */
    async createGuestCart(ip?: string) {
        await this.assertGuestCartQuota(ip);
        const guestToken = randomToken(24);
        await this.prisma.cart.create({
            data: {
                guestToken,
                storeId: null,
                expiresAt: this.expiry({ guestToken }),
            },
        });
        return { guestToken };
    }

    /** Cart row is created lazily on the FIRST add (guests included) -> no empty random carts. */
    async addItem(a: CartActor, dto: AddItemInput) {
        if (!!dto.variantId === !!dto.bundleId)
            throw new BadRequestException(
                this.i18n.translate("cart.errors.exactlyOneItem"),
            );
        const store = await this.prisma.store.findUnique({
            where: { id: dto.storeId },
            select: { id: true, status: true },
        });
        if (!store || store.status !== "ACTIVE")
            throw new NotFoundException(
                this.i18n.translate("cart.errors.storeNotAvailable"),
            );

        let cart = await this.find(a);
        let createdToken: string | undefined;
        if (!cart) {
            if (!a.userId) {
                await this.assertGuestCartQuota(dto.ip);
            }

            createdToken = a.userId ? undefined : randomToken(24);
            cart = await this.prisma.cart.create({
                data: {
                    userId: a.userId,
                    guestToken: createdToken,
                    storeId: dto.storeId,
                    expiresAt: this.expiry(a),
                },
            });
        } else if (cart.storeId && cart.storeId !== dto.storeId) {
            if (!dto.replaceStore)
                throw new ConflictException({
                    message: this.i18n.translate("cart.errors.storeMismatch"),
                    code: "STORE_MISMATCH",
                });
            await this.prisma.cartItem.deleteMany({
                where: { cartId: cart.id },
            });
            cart = await this.prisma.cart.update({
                where: { id: cart.id },
                data: { storeId: dto.storeId, couponCode: null },
            });
        } else if (!cart.storeId) {
            cart = await this.prisma.cart.update({
                where: { id: cart.id },
                data: { storeId: dto.storeId },
            });
        }

        const existing = await this.prisma.cartItem.findFirst({
            where: {
                cartId: cart.id,
                variantId: dto.variantId ?? null,
                bundleId: dto.bundleId ?? null,
            },
        });
        const qty = (existing?.quantity ?? 0) + dto.quantity;
        const [line] = await this.pricing.price(
            [
                {
                    variantId: dto.variantId ?? null,
                    bundleId: dto.bundleId ?? null,
                    quantity: qty,
                },
            ],
            dto.storeId,
            this.locale.defaultLanguage,
        );
        if (!line || !line.ok)
            throw new UnprocessableEntityException({
                message: this.i18n.translate("cart.errors.itemCannotBeAdded"),
                code: line?.issue ?? "UNAVAILABLE",
                available: line?.available ?? 0,
            });

        if (existing)
            await this.prisma.cartItem.update({
                where: { id: existing.id },
                data: { quantity: qty },
            });
        else
            await this.prisma.cartItem.create({
                data: {
                    cartId: cart.id,
                    variantId: dto.variantId,
                    bundleId: dto.bundleId,
                    quantity: qty,
                },
            });
        await this.prisma.cart.update({
            where: { id: cart.id },
            data: { expiresAt: this.expiry(a) },
        });
        return { guestToken: createdToken ?? a.guestToken };
    }

    async setQuantity(a: CartActor, itemId: bigint, quantity: number) {
        const cart = await this.find(a);
        if (!cart) {
            throw new NotFoundException(
                this.i18n.translate("cart.errors.cartNotFound"),
            );
        }
        const item = await this.prisma.cartItem.findFirst({
            where: { id: itemId, cartId: cart.id },
        });
        if (!item) {
            throw new NotFoundException(
                this.i18n.translate("cart.errors.itemNotFound"),
            );
        }
        if (quantity <= 0) {
            await this.prisma.cartItem.delete({ where: { id: item.id } });
        } else {
            if (cart.storeId) {
                const [line] = await this.pricing.price(
                    [
                        {
                            variantId: item.variantId,
                            bundleId: item.bundleId,
                            quantity,
                        },
                    ],
                    cart.storeId,
                    this.locale.defaultLanguage,
                );
                if (!line?.ok)
                    throw new UnprocessableEntityException({
                        message: this.i18n.translate(
                            "cart.errors.quantityNotAvailable",
                        ),
                        code: line?.issue,
                        available: line?.available ?? 0,
                    });
            }
            await this.prisma.cartItem.update({
                where: { id: item.id },
                data: { quantity },
            });
        }
        const left = await this.prisma.cartItem.count({
            where: { cartId: cart.id },
        });
        if (left === 0)
            await this.prisma.cart.delete({ where: { id: cart.id } }); // keep table lean
        else
            await this.prisma.cart.update({
                where: { id: cart.id },
                data: { expiresAt: this.expiry(a) },
            });
        return { success: true };
    }

    async clear(a: CartActor) {
        const cart = await this.find(a);
        if (cart) await this.prisma.cart.delete({ where: { id: cart.id } });
        return { success: true };
    }

    async applyCoupon(a: CartActor, code: string | null) {
        const cart = await this.find(a);
        if (!cart) {
            throw new NotFoundException(
                this.i18n.translate("cart.errors.cartNotFound"),
            );
        }
        await this.prisma.cart.update({
            where: { id: cart.id },
            data: { couponCode: code ? code.toUpperCase() : null },
        });
        return { success: true };
    }

    /** Called on customer login: guest items -> user cart; guest cart deleted. */
    async mergeGuestCart(guestToken: string, userId: bigint) {
        const guest = await this.prisma.cart.findUnique({
            where: { guestToken },
            include: { items: true },
        });
        if (!guest) return;
        await this.prisma.$transaction(async (tx) => {
            const mine = await tx.cart.findUnique({
                where: { userId },
                include: { items: true },
            });
            if (!guest.items.length || !guest.storeId) {
                await tx.cart.delete({ where: { id: guest.id } });
                return;
            }
            if (!mine) {
                await tx.cart.update({
                    where: { id: guest.id },
                    data: {
                        userId,
                        guestToken: null,
                        expiresAt: new Date(Date.now() + this.userMs),
                    },
                });
                return;
            }
            if (mine.items.length === 0 || !mine.storeId) {
                await tx.cartItem.deleteMany({ where: { cartId: mine.id } });
                await tx.cartItem.updateMany({
                    where: { cartId: guest.id },
                    data: { cartId: mine.id },
                });
                await tx.cart.update({
                    where: { id: mine.id },
                    data: { storeId: guest.storeId },
                });
            } else if (mine.storeId === guest.storeId) {
                for (const gi of guest.items) {
                    const same = mine.items.find(
                        (m) =>
                            m.variantId === gi.variantId &&
                            m.bundleId === gi.bundleId,
                    );
                    if (same)
                        await tx.cartItem.update({
                            where: { id: same.id },
                            data: { quantity: same.quantity + gi.quantity },
                        });
                    else
                        await tx.cartItem.create({
                            data: {
                                cartId: mine.id,
                                variantId: gi.variantId,
                                bundleId: gi.bundleId,
                                quantity: gi.quantity,
                            },
                        });
                }
            } // different store & user already has items: user's cart wins
            await tx.cart.delete({ where: { id: guest.id } });
            await tx.cart.update({
                where: { id: mine.id },
                data: { expiresAt: new Date(Date.now() + this.userMs) },
            });
        });
    }

    async deleteCartAfterOrder(userId: bigint) {
        await this.prisma.cart.deleteMany({ where: { userId } });
    }

    /** Keep the table small: drop expired carts in chunks. */
    @Cron(CronExpression.EVERY_HOUR)
    async cleanup() {
        const lock = await this.redis.lock("cron:cart-cleanup", 300);
        if (!lock) return;
        try {
            let total = 0;
            for (;;) {
                const ids = await this.prisma.cart.findMany({
                    where: { expiresAt: { lt: new Date() } },
                    select: { id: true },
                    take: 1000,
                });
                if (!ids.length) break;
                await this.prisma.cart.deleteMany({
                    where: { id: { in: ids.map((i) => i.id) } },
                });
                total += ids.length;
                if (ids.length < 1000) break;
            }
            if (total) this.log.log(`Deleted ${total} expired carts`);
        } finally {
            await lock();
        }
    }
}
