import { num, pageParams } from "@common/utils/helpers.util";
import { CurrencyService } from "@core/currency/currency.service";
import { PrismaService } from "@core/database/prisma.service";
import { FlashListInput, FlashSaleInput } from "./inventory.types";
import {
    BadRequestException,
    Injectable,
    NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma-client/client";
import { StoreListingStatus } from "@prisma-client/enums";
import { I18nService } from "nestjs-i18n";
import { LISTING_INCLUDE } from "./inventory.util";
import { InventoryCacheService } from "./inventory-cache.service";
import { ListingRulesService } from "./listing-rules.service";

/** Flash sales on store listings. */
@Injectable()
export class FlashSaleService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly i18n: I18nService,
        private readonly currency: CurrencyService,
        private readonly cache: InventoryCacheService,
        private readonly rules: ListingRulesService,
    ) {}

    // ---------------------------------------------------------------------
    // Private helpers
    // ---------------------------------------------------------------------

    /**
     * Translate a key. Interpolation values MUST be passed under `args`
     * (nestjs-i18n ignores them otherwise). Outside an HTTP request, e.g. in
     * cron jobs, the fallback language is used.
     */
    private t(key: string, args?: Record<string, string | number>): string {
        return this.i18n.translate(key, { args });
    }

    // ---------------------------------------------------------------------
    // Flash sales
    // ---------------------------------------------------------------------

    /** Start or schedule a flash sale on listings (replaces their current one). */
    async setFlashSale(storeId: bigint, dto: FlashSaleInput) {
        const startsAt = new Date(dto.startsAt);
        const endsAt = new Date(dto.endsAt);
        if (endsAt <= startsAt || endsAt <= new Date())
            throw new BadRequestException({
                message: this.t("inventory.errors.flashWindow"),
                code: "FLASH_WINDOW_INVALID",
            });
        if (endsAt.getTime() - startsAt.getTime() > 14 * 86400000)
            throw new BadRequestException({
                message: this.t("inventory.errors.flashTooLong"),
                code: "FLASH_TOO_LONG",
            });

        const ids = dto.items.map((i) => BigInt(i.storeProductId));
        const rows = await this.prisma.storeProduct.findMany({
            where: { storeId, id: { in: ids } },
        });
        const byId = new Map(rows.map((r) => [r.id.toString(), r]));

        const updates = dto.items.map((item) => {
            const sp = byId.get(String(item.storeProductId));
            if (!sp)
                throw new NotFoundException(
                    this.t("inventory.errors.listingNotInStore", {
                        id: String(item.storeProductId),
                    }),
                );
            if (
                sp.status !== StoreListingStatus.ACTIVE &&
                sp.status !== StoreListingStatus.SCHEDULED
            )
                throw new BadRequestException({
                    message: this.t("inventory.errors.flashNotLive", {
                        id: String(sp.id),
                    }),
                    code: "FLASH_LISTING_NOT_LIVE",
                });
            const base = num(sp.sellingPrice);
            const price =
                item.flashPrice ??
                Math.round(
                    base * (1 - (item.discountPercent ?? 0) / 100) * 100,
                ) / 100;
            if (price <= 0 || price >= base)
                throw new BadRequestException({
                    message: this.t("inventory.errors.flashPriceNotLower", {
                        price: String(base),
                    }),
                    code: "FLASH_PRICE_NOT_LOWER",
                });
            return {
                id: sp.id,
                productId: sp.productId,
                data: {
                    flashPrice: price,
                    flashStartsAt: startsAt,
                    flashEndsAt: endsAt,
                    flashQtyLimit: item.qtyLimit ?? null,
                    flashSoldQty: 0,
                    flashMaxPerOrder: dto.maxPerOrder ?? null,
                },
            };
        });
        await this.prisma.$transaction(
            updates.map((u) =>
                this.prisma.storeProduct.update({
                    where: { id: u.id },
                    data: u.data,
                }),
            ),
        );
        await this.cache.invalidateProducts(updates.map((u) => u.productId));
        return { success: true, updated: updates.length, startsAt, endsAt };
    }

    /** End flash sales now (upcoming ones are removed). */
    async endFlashSale(storeId: bigint, storeProductIds: number[]) {
        const now = new Date();
        const ids = storeProductIds.map((id) => BigInt(id));
        const [upcoming, live] = await this.prisma.$transaction([
            this.prisma.storeProduct.updateMany({
                where: { storeId, id: { in: ids }, flashStartsAt: { gt: now } },
                data: {
                    flashPrice: null,
                    flashStartsAt: null,
                    flashEndsAt: null,
                    flashQtyLimit: null,
                    flashSoldQty: 0,
                    flashMaxPerOrder: null,
                },
            }),
            this.prisma.storeProduct.updateMany({
                where: { storeId, id: { in: ids }, flashEndsAt: { gt: now } },
                data: { flashEndsAt: now },
            }),
        ]);
        const products = await this.prisma.storeProduct.findMany({
            where: { id: { in: ids } },
            select: { productId: true },
        });
        await this.cache.invalidateProducts(products.map((p) => p.productId));
        return { success: true, cancelled: upcoming.count, ended: live.count };
    }

    async listFlashSales(storeId: bigint, q: FlashListInput, lang?: string) {
        const { take, skip, page, limit } = pageParams(q);
        const now = new Date();
        const state = q.state ?? "all";
        const where: Prisma.StoreProductWhereInput = {
            storeId,
            flashPrice: { not: null },
            ...(state === "live" && {
                flashStartsAt: { lte: now },
                flashEndsAt: { gt: now },
            }),
            ...(state === "upcoming" && { flashStartsAt: { gt: now } }),
            ...(state === "ended" && { flashEndsAt: { lte: now } }),
        };
        const [rows, total] = await Promise.all([
            this.prisma.storeProduct.findMany({
                where,
                include: LISTING_INCLUDE,
                orderBy: { flashStartsAt: "desc" },
                take,
                skip,
            }),
            this.prisma.storeProduct.count({ where }),
        ]);
        return {
            currency: this.currency.info,
            items: rows.map((r) => this.rules.presentListing(r, lang)),
            total,
            page,
            limit,
        };
    }
}
