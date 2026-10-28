import { AuthUser } from "@common/types/auth.type";
import { num, pageParams, randomToken } from "@common/utils/helpers.util";
import { CurrencyService } from "@core/currency/currency.service";
import { PrismaService } from "@core/database/prisma.service";
import { LocaleService } from "@core/locale/locale.service";
import { PricingService } from "@modules/cart/pricing.service";
import { BundleInput } from "./bundles.types";
import { MediaService } from "@modules/media/media.service";
import {
    BadRequestException,
    Injectable,
    NotFoundException,
} from "@nestjs/common";
import { BundlePricingType, UserRole } from "@prisma-client/enums";
import { I18nService } from "nestjs-i18n";

@Injectable()
export class BundlesService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly locale: LocaleService,
        private readonly pricing: PricingService,
        private readonly media: MediaService,
        private readonly i18n: I18nService,
        private readonly currency: CurrencyService,
    ) {}

    async save(dto: BundleInput, user: AuthUser, id?: bigint) {
        // cleanMap validates (default language required) and trims the maps.
        const title = this.locale.cleanMap(dto.title, "title")!;
        const description = this.locale.cleanMap(
            dto.description,
            "description",
            false,
        );

        this.validatePricing(dto);
        await this.validateItems(dto);

        const isAdmin =
            user.role === UserRole.ADMIN || user.role === UserRole.SUPER_ADMIN;

        const storeId = isAdmin
            ? dto.storeId
                ? BigInt(dto.storeId)
                : null
            : user.storeId;

        if (!isAdmin && !storeId) {
            throw new BadRequestException(
                this.i18n.translate("bundles.errors.noStore"),
            );
        }

        const data = {
            storeId,
            title,
            description,
            thumbnailId: dto.thumbnailId ? BigInt(dto.thumbnailId) : null,
            pricingType: dto.pricingType,
            fixedPrice: dto.fixedPrice,
            discountValue: dto.discountValue,
            maxQtyPerOrder: dto.maxQtyPerOrder ?? 5,
            startsAt: dto.startsAt ? new Date(dto.startsAt) : null,
            endsAt: dto.endsAt ? new Date(dto.endsAt) : null,
            isActive: dto.isActive ?? true,
        };

        return this.prisma.$transaction(async (tx) => {
            if (id) {
                const current = await tx.bundle.findUnique({
                    where: { id },
                });

                if (!current || (!isAdmin && current.storeId !== storeId)) {
                    throw new NotFoundException(
                        this.i18n.translate("bundles.errors.notFound"),
                    );
                }

                await tx.bundleItem.deleteMany({
                    where: { bundleId: id },
                });

                return tx.bundle.update({
                    where: { id },
                    data: {
                        ...data,
                        // Slug is only changed when explicitly sent.
                        slug: dto.slug,
                        items: {
                            create: dto.items.map((item) => ({
                                variantId: BigInt(item.variantId),
                                quantity: item.quantity,
                            })),
                        },
                    },
                    include: {
                        items: true,
                    },
                });
            }

            return tx.bundle.create({
                data: {
                    ...data,
                    createdById: user.id,
                    slug: dto.slug ?? `bundle-${randomToken(4)}`,
                    items: {
                        create: dto.items.map((item) => ({
                            variantId: BigInt(item.variantId),
                            quantity: item.quantity,
                        })),
                    },
                },
                include: {
                    items: true,
                },
            });
        });
    }

    async remove(id: bigint, user: AuthUser) {
        await this.prisma.bundle.updateMany({
            where: {
                id,
                ...(user.storeId ? { storeId: user.storeId } : {}),
            },
            data: {
                isActive: false,
            },
        });

        return {
            success: true,
        };
    }

    async adminList(q: {
        q?: string;
        isActive?: boolean;
        storeId?: number;
        page?: number;
        limit?: number;
    }) {
        const limit = Math.min(Math.max(Number(q.limit ?? 20), 1), 100);
        const page = Math.max(Number(q.page ?? 1), 1);
        const skip = (page - 1) * limit;
        const where = {
            ...(q.isActive === undefined ? {} : { isActive: q.isActive }),
            ...(q.storeId ? { storeId: BigInt(q.storeId) } : {}),
            ...(q.q
                ? { slug: { contains: q.q, mode: "insensitive" as const } }
                : {}),
        };
        const [items, total] = await Promise.all([
            this.prisma.bundle.findMany({
                where,
                skip,
                take: limit,
                orderBy: { updatedAt: "desc" },
                include: {
                    thumbnail: {
                        select: { key: true, variants: true, isPrivate: true },
                    },
                    items: true,
                },
            }),
            this.prisma.bundle.count({ where }),
        ]);
        return {
            items: items.map((x) => ({
                ...x,
                thumbnailUrl: x.thumbnail
                    ? this.media.urlForVariant(x.thumbnail, "thumb")
                    : null,
            })),
            total,
            page,
            limit,
        };
    }

    async storeList(
        user: AuthUser,
        q: { q?: string; isActive?: boolean; page?: number; limit?: number },
    ) {
        if (!user.storeId) {
            throw new BadRequestException(
                this.i18n.translate("bundles.errors.noStore"),
            );
        }
        const { take, skip, page, limit } = pageParams(q);
        const where = {
            storeId: user.storeId,
            ...(q.isActive === undefined ? {} : { isActive: q.isActive }),
            ...(q.q
                ? { slug: { contains: q.q, mode: "insensitive" as const } }
                : {}),
        };
        const [items, total] = await Promise.all([
            this.prisma.bundle.findMany({
                where,
                skip,
                take,
                orderBy: { updatedAt: "desc" },
                include: {
                    thumbnail: {
                        select: { key: true, variants: true, isPrivate: true },
                    },
                    items: true,
                },
            }),
            this.prisma.bundle.count({ where }),
        ]);
        return {
            items: items.map((bundle) => ({
                ...bundle,
                thumbnailUrl: bundle.thumbnail
                    ? this.media.urlForVariant(bundle.thumbnail, "thumb")
                    : null,
            })),
            total,
            page,
            limit,
        };
    }

    /**
     * Storefront bundles for a store.
     *
     * Pricing and availability are derived from bundle components.
     */
    async storefront(storeId: bigint, lang: string) {
        const now = new Date();

        const bundles = await this.prisma.bundle.findMany({
            where: {
                isActive: true,
                OR: [{ storeId }, { storeId: null }],
                AND: [
                    {
                        OR: [
                            { startsAt: null },
                            {
                                startsAt: {
                                    lte: now,
                                },
                            },
                        ],
                    },
                    {
                        OR: [
                            { endsAt: null },
                            {
                                endsAt: {
                                    gte: now,
                                },
                            },
                        ],
                    },
                ],
            },
            include: {
                thumbnail: {
                    select: {
                        key: true,
                    },
                },
            },
            take: 100,
        });

        if (!bundles.length) {
            return [];
        }

        const lines = await this.pricing.price(
            bundles.map((bundle) => ({
                variantId: null,
                bundleId: bundle.id,
                quantity: 1,
            })),
            storeId,
            lang,
        );

        return lines.map((line, index) => {
            const bundle = bundles[index];

            return {
                id: bundle.id,
                slug: bundle.slug,
                title: line.title,
                thumbnailUrl: this.media.urlForKey(bundle.thumbnail?.key),
                currency: this.currency.info,
                price: this.currency.format(line.unitPrice),
                mrp: this.currency.format(line.mrp),
                savings: this.currency.format(
                    Math.max(num(line.mrp) - line.unitPrice, 0),
                ),
                available: line.ok,
                maxQty: Math.min(line.available, bundle.maxQtyPerOrder),
                items: line.components.map((component) => ({
                    variantId: component.variantId,
                    title: this.locale.pick(component.title, lang),
                    label: component.variantLabel,
                    quantity: component.quantity,
                })),
            };
        });
    }

    private validatePricing(dto: BundleInput) {
        if (
            dto.pricingType === BundlePricingType.FIXED_PRICE &&
            dto.fixedPrice == null
        ) {
            throw new BadRequestException(
                this.i18n.translate("bundles.errors.fixedPriceRequired"),
            );
        }

        if (
            dto.pricingType !== BundlePricingType.FIXED_PRICE &&
            dto.discountValue == null
        ) {
            throw new BadRequestException(
                this.i18n.translate("bundles.errors.discountValueRequired"),
            );
        }
    }

    /** Components must be unique and must exist (not soft-deleted). */
    private async validateItems(dto: BundleInput) {
        const variantIds = dto.items.map((item) => item.variantId);

        if (new Set(variantIds).size !== variantIds.length) {
            throw new BadRequestException(
                this.i18n.translate("bundles.errors.duplicateVariants"),
            );
        }

        const found = await this.prisma.productVariant.findMany({
            where: { id: { in: variantIds.map(BigInt) }, deletedAt: null },
            select: { id: true },
        });
        const foundIds = new Set(found.map((variant) => Number(variant.id)));
        const missing = variantIds.find((id) => !foundIds.has(id));

        if (missing !== undefined) {
            throw new BadRequestException(
                this.i18n.translate("bundles.errors.variantNotFound", {
                    args: { id: missing },
                }),
            );
        }
    }
}
