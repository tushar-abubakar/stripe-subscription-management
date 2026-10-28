import { CreateCouponInput, UpdateCouponInput } from "./orders.types";
import { PageQueryDto } from "@common/dto/page-query.dto";
import { money, num, pageParams } from "@common/utils/helpers.util";
import { CurrencyService } from "@core/currency/currency.service";
import { PrismaService } from "@core/database/prisma.service";
import { LocaleService } from "@core/locale/locale.service";
import {
    BadRequestException,
    Injectable,
    NotFoundException,
} from "@nestjs/common";
import { DiscountType } from "@prisma-client/enums";
import { I18nService } from "nestjs-i18n";

/** Order statuses that do not count as "coupon used". */
const INACTIVE_ORDER_STATUSES = ["CANCELLED", "FAILED", "REJECTED"] as const;

@Injectable()
export class CouponsService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly i18n: I18nService,
        private readonly locale: LocaleService,
        private readonly currency: CurrencyService,
    ) {}

    /**
     * Validates a coupon for a customer/cart and calculates the discount.
     *
     * @throws BadRequestException (code `COUPON_INVALID`) with a translated reason.
     */
    async validate(
        code: string,
        userId: bigint,
        storeId: bigint,
        subtotal: number,
    ) {
        const coupon = await this.prisma.coupon.findUnique({
            where: { code: code.toUpperCase() },
        });
        const now = new Date();

        const reject = (key: string, args?: Record<string, string>) =>
            new BadRequestException({
                message: this.i18n.translate(key, { args }),
                code: "COUPON_INVALID",
            });

        if (!coupon || !coupon.isActive) {
            throw reject("coupons.errors.invalid");
        }

        if (
            (coupon.startsAt && coupon.startsAt > now) ||
            (coupon.endsAt && coupon.endsAt < now)
        ) {
            throw reject("coupons.errors.expired");
        }

        if (coupon.storeId && coupon.storeId !== storeId) {
            throw reject("coupons.errors.notValidForStore");
        }

        if (coupon.minOrderValue && subtotal < num(coupon.minOrderValue)) {
            throw reject("coupons.errors.minOrder", {
                amount: this.currency.format(coupon.minOrderValue).formatted,
            });
        }

        if (coupon.usageLimit && coupon.usedCount >= coupon.usageLimit) {
            throw reject("coupons.errors.fullyRedeemed");
        }

        const activeStatuses = { notIn: [...INACTIVE_ORDER_STATUSES] };

        const timesUsed = await this.prisma.order.count({
            where: { userId, couponId: coupon.id, status: activeStatuses },
        });

        if (timesUsed >= coupon.perUserLimit) {
            throw reject("coupons.errors.alreadyUsed");
        }

        if (coupon.firstOrderOnly) {
            const previousOrders = await this.prisma.order.count({
                where: { userId, status: activeStatuses },
            });

            if (previousOrders > 0) {
                throw reject("coupons.errors.firstOrderOnly");
            }
        }

        let discount = 0;

        if (coupon.discountType === DiscountType.PERCENT) {
            discount = (subtotal * num(coupon.discountValue)) / 100;

            if (coupon.maxDiscount) {
                discount = Math.min(discount, num(coupon.maxDiscount));
            }
        } else if (coupon.discountType === DiscountType.FLAT) {
            discount = Math.min(num(coupon.discountValue), subtotal);
        }

        return {
            coupon,
            discount: money(discount),
            freeDelivery: coupon.discountType === DiscountType.FREE_DELIVERY,
        };
    }

    create(dto: CreateCouponInput) {
        const data = {
            ...dto,
            code: dto.code.toUpperCase(),
            storeId: dto.storeId ? BigInt(dto.storeId) : null,
            startsAt: dto.startsAt ? new Date(dto.startsAt) : null,
            endsAt: dto.endsAt ? new Date(dto.endsAt) : null,
            description: this.locale.cleanMap(
                dto.description,
                "description",
                false,
            ),
        };
        return this.prisma.coupon.create({ data });
    }

    async update(id: bigint, dto: UpdateCouponInput) {
        await this.get(id);
        const data = {
            ...dto,
            code: dto.code !== undefined ? dto.code.toUpperCase() : undefined,
            storeId:
                dto.storeId !== undefined
                    ? dto.storeId
                        ? BigInt(dto.storeId)
                        : null
                    : undefined,
            startsAt:
                dto.startsAt !== undefined
                    ? dto.startsAt
                        ? new Date(dto.startsAt)
                        : null
                    : undefined,
            endsAt:
                dto.endsAt !== undefined
                    ? dto.endsAt
                        ? new Date(dto.endsAt)
                        : null
                    : undefined,
            description:
                dto.description !== undefined
                    ? this.locale.cleanMap(
                          dto.description,
                          "description",
                          false,
                      )
                    : undefined,
        };
        return this.prisma.coupon.update({ where: { id }, data });
    }

    async list(query: PageQueryDto) {
        const { take, skip, page, limit } = pageParams(query, 50);
        const [items, total] = await Promise.all([
            this.prisma.coupon.findMany({
                orderBy: { id: "desc" },
                take,
                skip,
            }),
            this.prisma.coupon.count(),
        ]);
        return { items, total, page, limit };
    }

    async get(id: bigint) {
        const coupon = await this.prisma.coupon.findUnique({ where: { id } });
        if (!coupon) {
            throw new NotFoundException(
                this.i18n.translate("coupons.errors.notFound"),
            );
        }
        return coupon;
    }

    async deactivate(id: bigint) {
        const coupon = await this.prisma.coupon.findUnique({
            where: { id },
            select: { id: true },
        });
        if (!coupon) {
            throw new NotFoundException(
                this.i18n.translate("coupons.errors.notFound"),
            );
        }
        await this.prisma.coupon.update({
            where: { id },
            data: { isActive: false },
        });
        return { success: true, id: id.toString(), isActive: false };
    }
}
