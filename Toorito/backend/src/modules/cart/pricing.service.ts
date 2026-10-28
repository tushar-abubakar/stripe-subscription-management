import { flashState } from "@modules/inventory/inventory.util";
import { liveSurcharges } from "@modules/stores/stores.util";
import { money, num } from "@common/utils/helpers.util";
import { PrismaService } from "@core/database/prisma.service";
import { LocaleService } from "@core/locale/locale.service";
import { Injectable } from "@nestjs/common";

export interface Component {
    /** Priced at a live flash-sale price (checkout counts it against the flash quantity). */
    flash?: boolean;
    variantId: bigint;
    productId: bigint;
    storeProductId: bigint;
    categoryId: bigint;
    quantity: number;
    unitPrice: number;
    mrp: number;
    taxRate: number;
    hsnCode: string | null;
    sku: string;
    title: any;
    variantLabel: string | null;
    imageKey: string | null;
}

export interface PricedLine {
    cartItemId?: bigint;
    kind: "variant" | "bundle";
    variantId?: bigint;
    bundleId?: bigint;
    quantity: number;
    unitPrice: number;
    mrp: number;
    lineTotal: number;
    taxAmount: number;
    available: number;
    /** Line is priced at a live flash-sale price. */
    flashSale?: boolean;
    ok: boolean;
    issue?: string;
    title: string;
    titleMap: any;
    variantLabel: string | null;
    imageId: bigint | null;
    bundleTitleMap?: any;
    components: Component[];
}

@Injectable()
export class PricingService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly locale: LocaleService,
    ) {}

    taxIncluded(total: number, rate: number): number {
        return rate > 0 ? money(total - total / (1 + rate / 100)) : 0;
    }

    async price(
        items: {
            id?: bigint;
            variantId: bigint | null;
            bundleId: bigint | null;
            quantity: number;
        }[],
        storeId: bigint,
        lang: string,
    ): Promise<PricedLine[]> {
        const defaultLanguage = this.locale.defaultLanguage;

        const bundleIds = [
            ...new Set(
                items
                    .filter((item) => item.bundleId != null)
                    .map((item) => item.bundleId!),
            ),
        ];

        const bundles = bundleIds.length
            ? await this.prisma.bundle.findMany({
                  where: {
                      id: {
                          in: bundleIds,
                      },
                  },
                  include: {
                      items: true,
                  },
              })
            : [];

        const bMap = new Map(
            bundles.map((bundle) => [bundle.id.toString(), bundle]),
        );

        const variantIds = [
            ...new Set([
                ...items
                    .filter((item) => item.variantId != null)
                    .map((item) => item.variantId!),

                ...bundles.flatMap((bundle) =>
                    bundle.items.map((item) => item.variantId),
                ),
            ]),
        ];

        const langs = [...new Set([lang, defaultLanguage])];

        const variants = variantIds.length
            ? await this.prisma.productVariant.findMany({
                  where: {
                      id: {
                          in: variantIds,
                      },
                      deletedAt: null,
                  },
                  include: {
                      product: {
                          include: {
                              translations: {
                                  where: {
                                      lang: {
                                          in: langs,
                                      },
                                  },
                              },
                              thumbnail: {
                                  select: {
                                      key: true,
                                  },
                              },
                          },
                      },
                      optionValues: {
                          include: {
                              optionValue: {
                                  select: {
                                      label: true,
                                  },
                              },
                          },
                      },
                  },
              })
            : [];

        const vMap = new Map(
            variants.map((variant) => [variant.id.toString(), variant]),
        );

        const sps = variantIds.length
            ? await this.prisma.storeProduct.findMany({
                  where: {
                      storeId,
                      variantId: {
                          in: variantIds,
                      },
                  },
              })
            : [];

        const spMap = new Map(
            sps.map((storeProduct) => [
                storeProduct.variantId.toString(),
                storeProduct,
            ]),
        );

        const component = (
            variantId: bigint,
            qty: number,
        ): {
            c?: Component;
            avail: number;
            issue?: string;
        } => {
            const v = vMap.get(variantId.toString());

            const sp = spMap.get(variantId.toString());

            if (
                !v ||
                !v.isActive ||
                v.product.status !== "PUBLISHED" ||
                v.product.deletedAt
            ) {
                return {
                    avail: 0,
                    issue: "UNAVAILABLE",
                };
            }

            if (!sp || !sp.isActive) {
                return {
                    avail: 0,
                    issue: "NOT_IN_STORE",
                };
            }

            const mrp = num(sp.currentMrp ?? v.mrp);

            const tr =
                v.product.translations.find(
                    (translation) => translation.lang === lang,
                ) ??
                v.product.translations.find(
                    (translation) => translation.lang === defaultLanguage,
                );

            // optionValue.label is a locale map -> LocaleService handles the fallback.
            const label =
                v.optionValues
                    .map((option) =>
                        this.locale.pick(option.optionValue.label, lang),
                    )
                    .filter(Boolean)
                    .join(" / ") || null;

            /*
             * Keep the complete translation map instead of
             * creating a map containing only the requested
             * language.
             */
            const titleMap = Object.fromEntries(
                v.product.translations.map((translation) => [
                    translation.lang,
                    translation.title,
                ]),
            );

            return {
                avail: Math.max(num(sp.availableQty) - num(sp.reservedQty), 0),

                c: {
                    variantId,
                    productId: v.productId,
                    storeProductId: sp.id,
                    categoryId: sp.categoryId,
                    quantity: qty,
                    // Flash price while a flash sale is live (never above MRP).
                    unitPrice: Math.min(flashState(sp).price, mrp),
                    flash: flashState(sp).live,
                    mrp,
                    taxRate: num(v.product.gstRate),
                    hsnCode: v.product.hsnCode,
                    sku: v.sku,
                    title: titleMap,
                    variantLabel: label,
                    imageKey: v.product.thumbnail?.key ?? null,
                },
            };
        };

        const out: PricedLine[] = [];

        for (const it of items) {
            /*
             * =========================================================
             * NORMAL VARIANT
             * =========================================================
             */
            if (it.variantId != null) {
                const { c, avail, issue } = component(it.variantId, 1);

                const sp = spMap.get(it.variantId.toString());

                const min = num(sp?.minOrderQty ?? 1);

                // While a flash sale is live its per-order cap applies too.
                const flash = sp ? flashState(sp) : null;
                const max = Math.min(
                    sp?.maxOrderQty != null ? num(sp.maxOrderQty) : Infinity,
                    flash?.maxPerOrder ?? Infinity,
                );
                // Flash units left: buying more than that → the line is priced normally.
                if (c && flash?.live && flash.remaining != null && it.quantity > flash.remaining) {
                    c.unitPrice = Math.min(flash.regularPrice, c.mrp);
                    c.flash = false;
                }

                let problem = issue;

                if (!problem && it.quantity <= 0) {
                    problem = "INVALID_QUANTITY";
                }

                if (!problem && it.quantity > avail) {
                    problem =
                        avail === 0 ? "OUT_OF_STOCK" : "INSUFFICIENT_STOCK";
                }

                if (!problem && (it.quantity < min || it.quantity > max)) {
                    problem = "QTY_LIMIT";
                }

                const unit = c?.unitPrice ?? 0;

                const total = money(unit * it.quantity);

                const titleMap = c?.title ?? {};

                out.push({
                    cartItemId: it.id,
                    kind: "variant",
                    variantId: it.variantId,
                    quantity: it.quantity,
                    unitPrice: unit,
                    mrp: c?.mrp ?? 0,
                    lineTotal: total,
                    taxAmount: this.taxIncluded(total, c?.taxRate ?? 0),
                    available: avail,
                    flashSale: !!c?.flash,
                    ok: !problem,
                    issue: problem,
                    title: titleMap[lang] ?? titleMap[defaultLanguage] ?? "",
                    titleMap,
                    variantLabel: c?.variantLabel ?? null,
                    imageId: null,
                    components: c ? [c] : [],
                });

                continue;
            }

            /*
             * =========================================================
             * BUNDLE
             * =========================================================
             */
            if (it.bundleId != null) {
                const b = bMap.get(it.bundleId.toString());

                const now = new Date();

                let problem: string | undefined;

                /*
                 * Validate bundle itself.
                 */
                if (
                    !b ||
                    !b.isActive ||
                    (b.storeId != null && b.storeId !== storeId) ||
                    (b.startsAt != null && b.startsAt > now) ||
                    (b.endsAt != null && b.endsAt < now)
                ) {
                    problem = "UNAVAILABLE";
                }

                if (!problem && it.quantity <= 0) {
                    problem = "INVALID_QUANTITY";
                }

                const comps: Component[] = [];

                /*
                 * Number of complete bundles that can
                 * currently be produced from stock.
                 */
                let avail = Infinity;

                for (const bi of b?.items ?? []) {
                    /*
                     * Guard against invalid bundle data.
                     */
                    if (bi.quantity <= 0) {
                        problem ??= "UNAVAILABLE";
                        continue;
                    }

                    const r = component(bi.variantId, bi.quantity);

                    if (!r.c) {
                        problem ??= r.issue ?? "UNAVAILABLE";

                        continue;
                    }

                    comps.push(r.c);

                    avail = Math.min(avail, Math.floor(r.avail / bi.quantity));
                }

                if (!comps.length) {
                    problem ??= "UNAVAILABLE";
                }

                if (!Number.isFinite(avail)) {
                    avail = 0;
                }

                /*
                 * Base bundle price before discount.
                 */
                const sum = comps.reduce(
                    (total, c) => total + c.unitPrice * c.quantity,
                    0,
                );

                let unit = sum;

                if (b) {
                    if (b.pricingType === "FIXED_PRICE") {
                        unit = Math.min(num(b.fixedPrice), sum);
                    } else if (b.pricingType === "PERCENT_OFF") {
                        unit = sum * (1 - num(b.discountValue) / 100);

                        /*
                         * Never allow a negative
                         * bundle price.
                         */
                        unit = Math.max(unit, 0);
                    } else {
                        unit = Math.max(sum - num(b.discountValue), 0);
                    }
                }

                unit = money(unit);

                /*
                 * maxQtyPerOrder may be nullable.
                 */
                const maxQtyPerOrder =
                    b?.maxQtyPerOrder != null
                        ? num(b.maxQtyPerOrder)
                        : Infinity;

                const maxAvailable = Math.min(avail, maxQtyPerOrder);

                if (!problem && it.quantity > maxAvailable) {
                    problem =
                        avail === 0 ? "OUT_OF_STOCK" : "INSUFFICIENT_STOCK";
                }

                const total = money(unit * it.quantity);

                /*
                 * Allocate the bundle discount
                 * proportionally across components
                 * for tax calculation.
                 */
                const discountRatio = sum > 0 ? unit / sum : 0;

                const tax = comps.reduce(
                    (totalTax, c) =>
                        totalTax +
                        this.taxIncluded(
                            c.unitPrice *
                                c.quantity *
                                it.quantity *
                                discountRatio,
                            c.taxRate,
                        ),
                    0,
                );

                // Bundle multilingual title.
                const bundleTitleMap = (b?.title ?? {}) as Record<
                    string,
                    string
                >;

                const bundleTitle = this.locale.pick(bundleTitleMap, lang);

                out.push({
                    cartItemId: it.id,
                    kind: "bundle",
                    bundleId: it.bundleId,
                    quantity: it.quantity,
                    unitPrice: unit,
                    mrp: money(
                        comps.reduce(
                            (totalMrp, c) => totalMrp + c.mrp * c.quantity,
                            0,
                        ),
                    ),
                    lineTotal: total,
                    taxAmount: money(tax),
                    available: avail,
                    ok: !problem,
                    issue: problem,
                    title: bundleTitle,
                    titleMap: bundleTitleMap,
                    variantLabel: null,
                    imageId: b?.thumbnailId ?? null,
                    bundleTitleMap: bundleTitleMap,
                    components: comps,
                });
            }
        }

        return out;
    }

    /**
     * Delivery + handling fees of a cart. Live store surcharges (rain / night /
     * peak surge, packaging, custom — see Store.charges) are added to the
     * handling fee and also returned itemised in `surcharges`.
     */
    fees(
        store: {
            deliveryFee: any;
            freeDeliveryAbove: any;
            handlingFee: any;
            smallCartLimit: any;
            smallCartFee: any;
            charges?: unknown;
            timezone?: string;
        },
        subtotal: number,
        freeDelivery = false,
    ) {
        let delivery = num(store.deliveryFee);

        if (
            freeDelivery ||
            (store.freeDeliveryAbove != null &&
                subtotal >= num(store.freeDeliveryAbove))
        ) {
            delivery = 0;
        }

        const small =
            store.smallCartLimit != null && subtotal < num(store.smallCartLimit)
                ? num(store.smallCartFee)
                : 0;

        const surcharges = store.timezone
            ? liveSurcharges(store.charges, store.timezone, subtotal)
            : { items: [], total: 0 };

        return {
            deliveryFee: delivery,
            handlingFee: money(num(store.handlingFee) + small + surcharges.total),
            surcharges: surcharges.items,
            surchargeTotal: surcharges.total,
        };
    }
}
