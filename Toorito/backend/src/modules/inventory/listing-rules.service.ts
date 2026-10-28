import { AuthUser } from "@common/types/auth.type";
import { num } from "@common/utils/helpers.util";
import { AppConfig } from "@config/config.type";
import { CurrencyService } from "@core/currency/currency.service";
import { PrismaService } from "@core/database/prisma.service";
import { LocaleService } from "@core/locale/locale.service";
import { BarcodeInput, ListOnStoreInput } from "./inventory.types";
import { openApproval } from "@modules/approvals/approvals.repo";
import { MediaService } from "@modules/media/media.service";
import {
    BadRequestException,
    ConflictException,
    Injectable,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Prisma } from "@prisma-client/client";
import {
    ApprovalType,
    BarcodeType,
    ProductStatus,
    StoreListingStatus,
    StorePriceStatus,
} from "@prisma-client/enums";
import { I18nService } from "nestjs-i18n";
import {
    Tx,
    StoreProductSnapshot,
    SnapshotVariant,
    ListingRow,
} from "./inventory.types";
import { flashState, presentFlash } from "./inventory.util";

/**
 * Rules and presentation shared by every listing flow: price caps vs MRP, status / approval gates,
 * barcode requests, catalogue snapshots and the listing view model.
 */
@Injectable()
export class ListingRulesService {
    private readonly settings: AppConfig["inventory"];

    constructor(
        private readonly prisma: PrismaService,
        private readonly config: ConfigService,
        private readonly i18n: I18nService,
        private readonly currency: CurrencyService,
        private readonly locale: LocaleService,
        private readonly media: MediaService,
    ) {
        this.settings =
            this.config.getOrThrow<AppConfig["inventory"]>("inventory");
    }

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

    priceAboveMrp(mrp: number | Prisma.Decimal) {
        return new BadRequestException({
            message: this.t("inventory.errors.priceAboveMrp", {
                mrp: String(mrp),
            }),
            code: "PRICE_ABOVE_MRP",
        });
    }

    /**
     * Highest price a store may charge: the admin MRP, further capped by the
     * MRP printed on the batch currently being sold (legal requirement).
     */
    priceCap(variantMrp: unknown, currentMrp: unknown) {
        const admin = num(variantMrp);
        return currentMrp == null ? admin : Math.min(admin, num(currentMrp));
    }

    /** The catalogue allows selling this variant (product PUBLISHED, variant active, nothing deleted). */
    catalogLive(
        variant: { isActive: boolean; deletedAt: Date | null },
        product: { status: ProductStatus; deletedAt: Date | null },
    ) {
        return (
            variant.isActive &&
            !variant.deletedAt &&
            product.status === ProductStatus.PUBLISHED &&
            !product.deletedAt
        );
    }

    /**
     * Validates a requested listing status and returns the columns to write.
     * `isActive` is the derived "live" flag read by storefront, cart and
     * checkout: only ACTIVE listings of a live catalogue variant are live.
     */
    statusData(
        status: StoreListingStatus,
        publishAt: string | Date | null | undefined,
        catalogLive: boolean,
        sku: string,
    ): {
        status: StoreListingStatus;
        publishAt: Date | null;
        isActive: boolean;
    } {
        // A listing can only go (or be scheduled to go) live if the admin catalogue allows it.
        if (
            (status === StoreListingStatus.ACTIVE ||
                status === StoreListingStatus.SCHEDULED) &&
            !catalogLive
        )
            throw new BadRequestException({
                message: this.t("inventory.errors.variantInactive", { sku }),
                code: "CATALOG_NOT_LIVE",
            });

        if (status === StoreListingStatus.SCHEDULED) {
            if (!publishAt)
                throw new BadRequestException({
                    message: this.t("inventory.errors.publishAtRequired"),
                    code: "PUBLISH_AT_REQUIRED",
                });
            const at = new Date(publishAt);
            if (at.getTime() < Date.now() + 60_000)
                throw new BadRequestException({
                    message: this.t("inventory.errors.publishAtPast"),
                    code: "PUBLISH_AT_PAST",
                });
            return { status, publishAt: at, isActive: false };
        }

        return {
            status,
            publishAt: null,
            isActive: status === StoreListingStatus.ACTIVE,
        };
    }

    /** Columns of a listing waiting for an admin decision (never live). */
    awaitingState() {
        return {
            status: StoreListingStatus.PENDING_APPROVAL,
            publishAt: null,
            isActive: false,
        };
    }

    /** Status changes wait until the admin decided the barcode request (or it is cancelled). */
    assertNotAwaiting(sp: { status: StoreListingStatus; id: bigint }) {
        if (sp.status === StoreListingStatus.PENDING_APPROVAL)
            throw new ConflictException({
                message: this.t("inventory.errors.awaitingApproval", {
                    id: String(sp.id),
                }),
                code: "LISTING_AWAITING_APPROVAL",
            });
    }

    /**
     * Splits proposed barcodes: codes this variant already has are ignored,
     * codes of another variant (or proposed for one) are refused, the rest
     * need admin approval.
     */
    async planBarcodes(db: Tx, variantId: bigint, codes?: BarcodeInput[]) {
        if (!codes?.length) return [];
        const unique = [
            ...new Map(
                codes.map((c) => [
                    c.code.trim(),
                    { ...c, code: c.code.trim() },
                ]),
            ).values(),
        ];
        const existing = await db.productBarcode.findMany({
            where: { code: { in: unique.map((c) => c.code) } },
            select: { code: true, variantId: true },
        });
        const fresh: BarcodeInput[] = [];
        for (const c of unique) {
            const hit = existing.find((e) => e.code === c.code);
            if (hit && hit.variantId === variantId) continue;
            if (hit)
                throw new ConflictException({
                    message: this.t("inventory.errors.barcodeTaken", {
                        code: c.code,
                    }),
                    code: "BARCODE_TAKEN",
                });
            const proposed = await db.$queryRaw<
                { id: bigint; variantId: string }[]
            >`
                SELECT id, payload->>'variantId' AS "variantId" FROM "ApprovalRequest"
                WHERE type = 'BARCODE_ADD' AND status = 'PENDING'
                  AND payload->'codes' @> ${JSON.stringify([c.code])}::jsonb LIMIT 1`;
            if (
                proposed.length &&
                proposed[0].variantId !== variantId.toString()
            )
                throw new ConflictException({
                    message: this.t("inventory.errors.barcodePending", {
                        code: c.code,
                    }),
                    code: "BARCODE_PENDING",
                });
            if (!proposed.length) fresh.push(c);
        }
        return fresh;
    }

    openBarcodeRequest(
        tx: Tx,
        actor: AuthUser,
        sp: { id: bigint; storeId: bigint },
        variantId: bigint,
        codes: BarcodeInput[],
        opts: {
            gate: boolean;
            state?: { status: StoreListingStatus; publishAt: Date | null };
            note?: string;
        },
    ) {
        return openApproval(tx, actor, {
            type: ApprovalType.BARCODE_ADD,
            storeId: sp.storeId,
            targetType: "StoreProduct",
            targetId: sp.id,
            note: opts.note,
            payload: {
                variantId,
                codes: codes.map((c) => c.code),
                barcodes: codes.map((c) => ({
                    code: c.code,
                    type: c.type ?? BarcodeType.EAN13,
                })),
                // gate = the listing was created with this request and waits in PENDING_APPROVAL
                gate: opts.gate,
                requestedStatus: opts.state?.status ?? null,
                publishAt: opts.state?.publishAt ?? null,
            },
        });
    }

    thumbUrl(
        thumb: {
            key: string;
            isPrivate: boolean;
            variants: unknown;
            status: string;
        } | null,
    ) {
        return thumb && thumb.status === "READY"
            ? this.media.urlForVariant(thumb, "thumb")
            : null;
    }

    /** lang → title map from translation rows. */
    titleMap(rows: { lang: string; title: string }[]) {
        return Object.fromEntries(rows.map((r) => [r.lang, r.title]));
    }

    /** Builds the store-side copy of one catalogue variant. */
    buildSnapshot(v: SnapshotVariant): StoreProductSnapshot {
        const p = v.product;
        return {
            version: 1,
            productId: p.id.toString(),
            variantId: v.id.toString(),
            slug: p.slug,
            title: this.titleMap(p.translations),
            brand: p.brand
                ? { id: p.brand.id.toString(), name: p.brand.name }
                : null,
            category: p.category
                ? { id: p.category.id.toString(), name: p.category.name }
                : null,
            thumbnailId: p.thumbnailId?.toString() ?? null,
            sku: v.sku,
            options: v.optionValues.map((o) => ({
                group: o.optionValue.optionGroup.code,
                groupName: o.optionValue.optionGroup.name,
                value: o.optionValue.code,
                label: o.optionValue.label,
            })),
            unit: v.unit,
            unitValue: v.unitValue == null ? null : num(v.unitValue),
            weightGrams: v.weightGrams,
            mrp: num(v.mrp),
            gstRate: num(p.gstRate),
            hsnCode: p.hsnCode,
            dietType: p.dietType,
            isPerishable: p.isPerishable,
            shelfLifeDays: p.shelfLifeDays,
            barcodes: v.barcodes.map((b) => b.code),
            capturedAt: new Date().toISOString(),
        };
    }

    /** API shape of one listing (money formatted, stock derived). */
    presentListing(row: ListingRow, lang?: string) {
        const sellable = row.availableQty - row.reservedQty;
        const { variant, product, ...listing } = row;
        const titles = this.titleMap(product.translations);
        // Listings created before snapshots existed carry `{}`: report them as outdated too.
        const outdated =
            !(row.snapshot as { version?: number } | null)?.version ||
            row.snapshotAt < product.updatedAt ||
            row.snapshotAt < variant.updatedAt;
        return {
            ...listing,
            title: this.locale.pick(titles, lang),
            variantLabel:
                variant.optionValues
                    .map((o) => this.locale.pick(o.optionValue.label, lang))
                    .join(" / ") || null,
            thumbnailUrl: this.thumbUrl(product.thumbnail),
            sellingPrice: this.currency.format(listing.sellingPrice),
            currentMrp: this.currency.formatOrNull(listing.currentMrp),
            variant: {
                sku: variant.sku,
                mrp: this.currency.format(variant.mrp),
                isActive: variant.isActive,
            },
            product: { slug: product.slug, status: product.status },
            /** Visible & sellable on the storefront right now. */
            isLive: listing.isActive,
            flashSale: presentFlash(listing, this.currency),
            /** Price customers pay right now (flash price while a flash sale is live). */
            effectivePrice: this.currency.format(flashState(listing).price),
            /** Store wants it ACTIVE but the admin unpublished / disabled the catalogue item. */
            catalogBlocked:
                listing.status === StoreListingStatus.ACTIVE &&
                !listing.isActive,
            sellable,
            lowStock: sellable <= listing.lowStockThreshold,
            outOfStock: sellable <= 0,
            /** The catalogue changed after the snapshot was taken (re-sync available). */
            snapshotOutdated: outdated,
        };
    }

    /**
     * Barcodes per variation as the store sees them: the catalogue's codes
     * (approved), codes this store proposed that wait for the admin, and
     * the store's proposals rejected in the last 30 days (with the note).
     * Two queries for any number of variations.
     */
    async barcodeView(storeId: bigint, variantIds: bigint[]) {
        const out = new Map<
            string,
            {
                approved: {
                    code: string;
                    type: BarcodeType;
                    isPrimary: boolean;
                }[];
                pending: object[];
                rejected: object[];
            }
        >();
        if (!variantIds.length) return out;
        for (const id of variantIds)
            out.set(id.toString(), { approved: [], pending: [], rejected: [] });
        const since = new Date(Date.now() - 30 * 86400000);
        const [codes, requests] = await Promise.all([
            this.prisma.productBarcode.findMany({
                where: { variantId: { in: variantIds } },
                select: {
                    variantId: true,
                    code: true,
                    type: true,
                    isPrimary: true,
                },
                orderBy: [{ isPrimary: "desc" }, { id: "asc" }],
            }),
            this.prisma.approvalRequest.findMany({
                where: {
                    storeId,
                    type: ApprovalType.BARCODE_ADD,
                    OR: [
                        { status: "PENDING" },
                        { status: "REJECTED", reviewedAt: { gte: since } },
                    ],
                },
                select: {
                    id: true,
                    status: true,
                    payload: true,
                    note: true,
                    reviewNote: true,
                    createdAt: true,
                    reviewedAt: true,
                },
                orderBy: { id: "desc" },
                take: 500,
            }),
        ]);
        for (const c of codes)
            out
                .get(c.variantId.toString())
                ?.approved.push({
                    code: c.code,
                    type: c.type,
                    isPrimary: c.isPrimary,
                });
        for (const r of requests) {
            const p = r.payload as { variantId?: string; codes?: string[] };
            const slot = p?.variantId
                ? out.get(String(p.variantId))
                : undefined;
            if (!slot) continue;
            const row = {
                approvalId: r.id,
                codes: p.codes ?? [],
                note: r.note,
                requestedAt: r.createdAt,
            };
            if (r.status === "PENDING") slot.pending.push(row);
            else
                slot.rejected.push({
                    ...row,
                    reviewNote: r.reviewNote,
                    reviewedAt: r.reviewedAt,
                });
        }
        return out;
    }

    assertOrderQty(min?: number | null, max?: number | null) {
        if (max && min && max < min)
            throw new BadRequestException(this.t("inventory.errors.maxLtMin"));
    }

    alreadyListed(storeProductId?: bigint) {
        return new ConflictException({
            message: this.t("inventory.errors.alreadyListed"),
            storeProductId,
        });
    }

    async createListingTx(
        tx: Tx,
        storeId: bigint,
        variant: SnapshotVariant,
        input: Omit<ListOnStoreInput, "variantId" | "status" | "publishAt">,
        state: ReturnType<ListingRulesService["statusData"]>,
        actor: AuthUser,
    ) {
        const sp = await tx.storeProduct.create({
            data: {
                storeId,
                variantId: variant.id,
                productId: variant.productId,
                categoryId: variant.product.categoryId!,
                sellingPrice: input.sellingPrice,
                currentMrp: variant.mrp,
                lowStockThreshold:
                    input.lowStockThreshold ?? this.settings.lowStockDefault,
                minOrderQty: input.minOrderQty ?? 1,
                maxOrderQty: input.maxOrderQty,
                trackBatches: input.trackBatches ?? true,
                minSellableDays: input.minSellableDays ?? 0,
                shelfLocation: input.shelfLocation,
                status: state.status,
                publishAt: state.publishAt,
                isActive: state.isActive,
                priceStatus: StorePriceStatus.CUSTOM,
                snapshot: this.buildSnapshot(
                    variant,
                ) as unknown as Prisma.InputJsonValue,
                snapshotAt: new Date(),
                listedById: actor.id,
            },
        });
        await tx.storePriceHistory.create({
            data: {
                storeProductId: sp.id,
                oldPrice: input.sellingPrice,
                newPrice: input.sellingPrice,
                newMrp: variant.mrp,
                reason: "MANUAL",
                changedById: actor.id,
            },
        });
        return sp;
    }
}
