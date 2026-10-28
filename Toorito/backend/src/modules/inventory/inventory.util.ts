import { num } from "@common/utils/helpers.util";
import { CurrencyService } from "@core/currency/currency.service";
import { Prisma } from "@prisma-client/client";
import { FlashFields } from "./inventory.types";

/** Pure helpers and Prisma selections shared by the inventory services. */

/** Everything needed to build a snapshot from a catalogue variant. */
export const SNAPSHOT_VARIANT_INCLUDE = {
    product: {
        select: {
            id: true,
            slug: true,
            status: true,
            deletedAt: true,
            categoryId: true,
            thumbnailId: true,
            dietType: true,
            hsnCode: true,
            gstRate: true,
            isPerishable: true,
            shelfLifeDays: true,
            translations: { select: { lang: true, title: true } },
            brand: { select: { id: true, name: true } },
            category: { select: { id: true, name: true } },
        },
    },
    optionValues: {
        select: {
            optionValue: {
                select: {
                    code: true,
                    label: true,
                    optionGroup: { select: { code: true, name: true } },
                },
            },
        },
    },
    barcodes: { select: { code: true } },
} satisfies Prisma.ProductVariantInclude;

export const THUMB_SELECT = {
    select: { key: true, isPrivate: true, variants: true, status: true },
} as const;

/** Columns + relations used by every listing response. */
export const LISTING_INCLUDE = {
    variant: {
        select: {
            sku: true,
            mrp: true,
            isActive: true,
            updatedAt: true,
            optionValues: {
                select: { optionValue: { select: { label: true } } },
            },
        },
    },
    product: {
        select: {
            slug: true,
            status: true,
            updatedAt: true,
            translations: { select: { lang: true, title: true } },
            thumbnail: THUMB_SELECT,
        },
    },
} satisfies Prisma.StoreProductInclude;

/** Prisma unique-constraint violation (P2002), i.e. a lost race on a unique key. */
export const isUniqueViolation = (e: unknown) =>
    e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";

/**
 * Price a customer pays now. A flash sale is live inside its window while
 * units remain; its price never exceeds the selling price.
 */
export function flashState(sp: FlashFields, now = new Date()) {
    const selling = num(sp.sellingPrice);
    const remaining =
        sp.flashQtyLimit == null
            ? null
            : Math.max(sp.flashQtyLimit - sp.flashSoldQty, 0);
    const live =
        sp.flashPrice != null &&
        !!sp.flashStartsAt &&
        !!sp.flashEndsAt &&
        sp.flashStartsAt <= now &&
        now < sp.flashEndsAt &&
        (remaining == null || remaining > 0);
    return {
        live,
        price: live ? Math.min(num(sp.flashPrice), selling) : selling,
        regularPrice: selling,
        remaining,
        maxPerOrder: live ? sp.flashMaxPerOrder : null,
        endsAt: live ? sp.flashEndsAt : null,
    };
}

export function presentFlash(sp: FlashFields, currency: CurrencyService) {
    if (sp.flashPrice == null) return null;
    const now = new Date();
    const st = flashState(sp, now);
    const state = st.live
        ? "LIVE"
        : sp.flashStartsAt && sp.flashStartsAt > now
          ? "UPCOMING"
          : st.remaining === 0 && sp.flashEndsAt && sp.flashEndsAt > now
            ? "SOLD_OUT"
            : "ENDED";
    return {
        state,
        price: currency.format(sp.flashPrice),
        startsAt: sp.flashStartsAt,
        endsAt: sp.flashEndsAt,
        qtyLimit: sp.flashQtyLimit,
        soldQty: sp.flashSoldQty,
        remaining: st.remaining,
        maxPerOrder: sp.flashMaxPerOrder,
    };
}

/** Upper bound of low-stock listing ids loaded for one request. */
export const LOW_STOCK_ID_CAP = 2000;

/** `%`, `_` and `\` are LIKE wildcards; user input must match literally. */
export const cleanSearch = (q?: string) =>
    (q ?? "")
        .trim()
        .toLowerCase()
        .replace(/[%_\\]/g, " ")
        .trim();
