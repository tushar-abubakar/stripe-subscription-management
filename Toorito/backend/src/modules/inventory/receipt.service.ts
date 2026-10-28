import { MEDIA_ROUTES } from "@modules/media/media.routes";
import { AuthUser } from "@common/types/auth.type";
import {
    addDays,
    docNumber,
    num,
    pageParams,
    todayInTz,
    zonedStartOfDay,
} from "@common/utils/helpers.util";
import { AppConfig } from "@config/config.type";
import { CurrencyService } from "@core/currency/currency.service";
import { PrismaService } from "@core/database/prisma.service";
import { LocaleService } from "@core/locale/locale.service";
import {
    GrnEditRequestInput,
    ReceiptListInput,
    ReceiptItemDto,
    ReceiveGoodsInput,
} from "./inventory.types";
import { openApproval } from "@modules/approvals/approvals.repo";
import {
    BadRequestException,
    ConflictException,
    Injectable,
    NotFoundException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Prisma } from "@prisma-client/client";
import {
    ApprovalType,
    BatchStatus,
    GoodsReceiptStatus,
    MediaPurpose,
    StockMovementType,
    StoreListingStatus,
    UserRole,
} from "@prisma-client/enums";
import { I18nService } from "nestjs-i18n";
import { Tx, ListingForReceipt, ReceiptContext } from "./inventory.types";
import { InventoryCacheService } from "./inventory-cache.service";
import { ListingRulesService } from "./listing-rules.service";
import { StockService } from "./stock.service";

/** Goods receipts (GRN): receiving stock, purchase records and approved GRN corrections. */
@Injectable()
export class ReceiptService {
    private readonly settings: AppConfig["inventory"];

    constructor(
        private readonly prisma: PrismaService,
        private readonly config: ConfigService,
        private readonly i18n: I18nService,
        private readonly currency: CurrencyService,
        private readonly locale: LocaleService,
        private readonly cache: InventoryCacheService,
        private readonly rules: ListingRulesService,
        private readonly stock: StockService,
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

    // ---------------------------------------------------------------------
    // Goods receipt (GRN) — stock in
    // ---------------------------------------------------------------------

    /**
     * Invoice files must be INVOICE media uploaded by someone of this store
     * (or an admin) and not attached to another goods receipt.
     */
    private async assertInvoiceMedia(
        db: Tx | PrismaService,
        storeId: bigint,
        ids: number[],
        exceptGrnId?: bigint,
    ) {
        const files = await db.mediaFile.findMany({
            where: {
                id: { in: ids.map((id) => BigInt(id)) },
                purpose: MediaPurpose.INVOICE,
                deletedAt: null,
                uploadedBy: {
                    OR: [
                        { storeId },
                        {
                            role: {
                                in: [UserRole.ADMIN, UserRole.SUPER_ADMIN],
                            },
                        },
                    ],
                },
            },
            select: { id: true },
        });
        if (files.length !== ids.length)
            throw new BadRequestException({
                message: this.t("inventory.errors.invoiceMediaInvalid"),
                code: "INVOICE_MEDIA_INVALID",
            });
        for (const id of ids) {
            const used = await db.$queryRaw<{ id: bigint }[]>`
                SELECT id FROM "GoodsReceipt" WHERE "invoiceMediaIds" @> ${JSON.stringify([id])}::jsonb
                ${exceptGrnId ? Prisma.sql`AND id <> ${exceptGrnId}` : Prisma.empty} LIMIT 1`;
            if (used.length)
                throw new ConflictException({
                    message: this.t("inventory.errors.invoiceMediaUsed"),
                    code: "INVOICE_MEDIA_IN_USE",
                    grnId: used[0].id,
                });
        }
    }

    /**
     * Stock in against a supplier invoice: invoice file(s) mandatory; one
     * invoice = many products; one product = many batches. Only listings
     * that are not waiting for admin approval can receive stock.
     */
    async receive(storeId: bigint, dto: ReceiveGoodsInput, actor: AuthUser) {
        const tz = await this.cache.storeTz(this.prisma, storeId);
        const today = todayInTz(tz);
        const touchedProducts = new Set<bigint>();

        // Same supplier + invoice number can't be posted twice.
        const duplicate = await this.prisma.goodsReceipt.findFirst({
            where: {
                storeId,
                supplierInvoiceNo: {
                    equals: dto.supplierInvoiceNo.trim(),
                    mode: "insensitive",
                },
                supplierName: {
                    equals: dto.supplierName.trim(),
                    mode: "insensitive",
                },
            },
            select: { id: true, grnNumber: true },
        });
        if (duplicate)
            throw new ConflictException({
                message: this.t("inventory.errors.duplicateInvoice", {
                    grn: duplicate.grnNumber,
                }),
                code: "DUPLICATE_INVOICE",
                grnId: duplicate.id,
            });
        await this.assertInvoiceMedia(
            this.prisma,
            storeId,
            dto.invoiceMediaIds,
        );

        // One invoice line per batch of each product.
        const lines: ReceiptItemDto[] = dto.items.flatMap((item) =>
            item.batches.map((batch) => ({
                ...batch,
                storeProductId: item.storeProductId,
            })),
        );

        const grn = await this.prisma.$transaction(
            async (tx) => {
                const g = await tx.goodsReceipt.create({
                    data: {
                        grnNumber: docNumber("GRN"),
                        storeId,
                        supplierName: dto.supplierName,
                        supplierPhone: dto.supplierPhone,
                        supplierInvoiceNo: dto.supplierInvoiceNo,
                        supplierInvoiceDate: dto.supplierInvoiceDate
                            ? new Date(dto.supplierInvoiceDate)
                            : undefined,
                        receivedById: actor.id,
                        note: dto.note,
                        invoiceMediaIds: dto.invoiceMediaIds,
                    },
                });

                // Load every listing once instead of one query per line.
                const listings = new Map<bigint, ListingForReceipt>(
                    (
                        await tx.storeProduct.findMany({
                            where: {
                                storeId,
                                id: {
                                    in: lines.map((i) =>
                                        BigInt(i.storeProductId),
                                    ),
                                },
                            },
                            include: {
                                product: {
                                    select: {
                                        isPerishable: true,
                                        shelfLifeDays: true,
                                    },
                                },
                            },
                        })
                    ).map((sp) => [sp.id, sp]),
                );

                const ctx: ReceiptContext = {
                    grnId: g.id,
                    storeId,
                    actorId: actor.id,
                    supplierName: dto.supplierName,
                    tz,
                    today,
                };
                // Lines run sequentially: the same listing/batch may appear more than once.
                for (const it of lines) {
                    const sp = listings.get(BigInt(it.storeProductId));
                    if (!sp)
                        throw new NotFoundException(
                            this.t("inventory.errors.listingNotInStore", {
                                id: String(it.storeProductId),
                            }),
                        );
                    if (sp.status === StoreListingStatus.PENDING_APPROVAL)
                        throw new ConflictException({
                            message: this.t(
                                "inventory.errors.awaitingApproval",
                                { id: String(sp.id) },
                            ),
                            code: "LISTING_AWAITING_APPROVAL",
                        });
                    touchedProducts.add(sp.productId);
                    await this.receiveLine(tx, ctx, sp, it);
                }
                return g;
            },
            { timeout: this.settings.receiveTxTimeoutMs },
        );

        await this.cache.invalidateProducts(touchedProducts);
        return this.prisma.goodsReceipt.findUnique({
            where: { id: grn.id },
            include: { items: true },
        });
    }

    /** Process one GRN line: validate, upsert the batch, move stock, record the line. */
    private async receiveLine(
        tx: Tx,
        ctx: ReceiptContext,
        sp: ListingForReceipt,
        it: ReceiptItemDto,
    ) {
        const { storeId, actorId, grnId, today, tz } = ctx;
        const rejected = it.rejectedQty ?? 0;
        const accepted = it.receivedQty - rejected;
        if (accepted < 0)
            throw new BadRequestException(
                this.t("inventory.errors.rejectedGtReceived"),
            );

        let batchId: bigint | null = null;
        let batchNumber = "-";
        let mfg: Date | null = null;
        let expiry: Date | null = null;
        let shelf: number | null = null;

        if (sp.trackBatches) {
            if (!it.batchNumber?.trim())
                throw new BadRequestException(
                    this.t("inventory.errors.batchNumberRequired"),
                );
            batchNumber = it.batchNumber.trim().toUpperCase();
            mfg = it.manufacturedAt ? new Date(it.manufacturedAt) : null;
            shelf = it.shelfLifeDays ?? sp.product.shelfLifeDays ?? null;
            expiry = it.expiryDate ? new Date(it.expiryDate) : null;
            // Derive expiry from manufacture date + shelf life when not given.
            if (!expiry && mfg && shelf) expiry = addDays(mfg, shelf);

            if (sp.product.isPerishable && !expiry)
                throw new BadRequestException(
                    this.t("inventory.errors.expiryMandatory", {
                        id: String(sp.id),
                    }),
                );
            if (expiry && expiry < today)
                throw new BadRequestException(
                    this.t("inventory.errors.batchExpired", {
                        batch: batchNumber,
                    }),
                );
            if (mfg && expiry && mfg > expiry)
                throw new BadRequestException(
                    this.t("inventory.errors.mfgAfterExpiry"),
                );

            // Batches closer to expiry than the listing's minimum shelf life are quarantined.
            const sellable =
                !expiry || expiry >= addDays(today, sp.minSellableDays);

            const existing = await tx.inventoryBatch.findUnique({
                where: {
                    storeProductId_batchNumber: {
                        storeProductId: sp.id,
                        batchNumber,
                    },
                },
            });
            // A batch number identifies one MRP + expiry; a different combo is a data error.
            if (
                existing &&
                (num(existing.mrp) !== it.mrp ||
                    (existing.expiryDate?.getTime() ?? 0) !==
                        (expiry?.getTime() ?? 0))
            )
                throw new ConflictException({
                    message: this.t("inventory.errors.batchConflict", {
                        batch: batchNumber,
                    }),
                    code: "BATCH_CONFLICT",
                });

            const batch = existing
                ? await tx.inventoryBatch.update({
                      where: { id: existing.id },
                      data: {
                          receivedQty: { increment: accepted },
                          availableQty: { increment: accepted },
                          // A depleted batch that receives stock comes back to life.
                          ...(existing.status === BatchStatus.DEPLETED &&
                              accepted > 0 && {
                                  status: sellable
                                      ? BatchStatus.ACTIVE
                                      : BatchStatus.QUARANTINE,
                              }),
                      },
                  })
                : await tx.inventoryBatch.create({
                      data: {
                          storeProductId: sp.id,
                          storeId,
                          variantId: sp.variantId,
                          batchNumber,
                          manufacturedAt: mfg,
                          expiryDate: expiry,
                          shelfLifeDays: shelf,
                          mrp: it.mrp,
                          costPrice: it.costPrice,
                          receivedQty: accepted,
                          availableQty: accepted,
                          // Fully rejected delivery: nothing on hand, so don't leave an "ACTIVE" empty batch.
                          status:
                              accepted === 0
                                  ? BatchStatus.DEPLETED
                                  : sellable
                                    ? BatchStatus.ACTIVE
                                    : BatchStatus.QUARANTINE,
                          supplierName: ctx.supplierName,
                          note: sellable
                              ? undefined
                              : this.t("inventory.notes.belowShelfLife"),
                      },
                  });
            batchId = batch.id;

            // Only ACTIVE batches count towards store-level availableQty.
            if (accepted > 0 && batch.status === BatchStatus.ACTIVE)
                await this.recordPurchase(
                    tx,
                    ctx,
                    sp.id,
                    accepted,
                    it.costPrice,
                    batch,
                );
            await this.stock.refreshMrp(tx, sp.id, actorId, tz);
        } else if (accepted > 0) {
            // Non-batch inventory: store-level quantity only.
            await this.recordPurchase(tx, ctx, sp.id, accepted, it.costPrice);
        }

        await tx.goodsReceiptItem.create({
            data: {
                goodsReceiptId: grnId,
                storeProductId: sp.id,
                variantId: sp.variantId,
                batchNumber,
                manufacturedAt: mfg,
                expiryDate: expiry,
                shelfLifeDays: shelf ?? it.shelfLifeDays,
                receivedQty: it.receivedQty,
                rejectedQty: rejected,
                rejectReason: it.rejectReason,
                costPrice: it.costPrice,
                mrp: it.mrp,
                batchId,
            },
        });
    }

    /** Add accepted stock to the store balance and log the PURCHASE movement. */
    private async recordPurchase(
        tx: Tx,
        ctx: ReceiptContext,
        spId: bigint,
        qty: number,
        unitCost?: number,
        batch?: { id: bigint; availableQty: number },
    ) {
        const balanceAfter = await this.stock.bumpAvailable(tx, spId, qty);
        await tx.stockMovement.create({
            data: {
                storeId: ctx.storeId,
                storeProductId: spId,
                batchId: batch?.id,
                type: StockMovementType.PURCHASE,
                quantity: qty,
                balanceAfter,
                batchBalanceAfter: batch?.availableQty,
                unitCost,
                refType: "GRN",
                refId: ctx.grnId,
                actorId: ctx.actorId,
            },
        });
    }

    async receipts(storeId: bigint, query: ReceiptListInput) {
        const { take, skip, page, limit } = pageParams(query);
        const tz = await this.cache.storeTz(this.prisma, storeId);
        const q = query.q?.trim();
        const where: Prisma.GoodsReceiptWhereInput = {
            storeId,
            ...(q && {
                OR: [
                    { grnNumber: { contains: q, mode: "insensitive" } },
                    { supplierName: { contains: q, mode: "insensitive" } },
                    { supplierInvoiceNo: { contains: q, mode: "insensitive" } },
                ],
            }),
            ...((query.from || query.to) && {
                receivedAt: {
                    ...(query.from && { gte: zonedStartOfDay(query.from, tz) }),
                    ...(query.to && {
                        lt: addDays(zonedStartOfDay(query.to, tz), 1),
                    }),
                },
            }),
        };
        const [rows, total] = await Promise.all([
            this.prisma.goodsReceipt.findMany({
                where,
                orderBy: { id: "desc" },
                take,
                skip,
                include: {
                    items: {
                        select: {
                            receivedQty: true,
                            rejectedQty: true,
                            costPrice: true,
                        },
                    },
                },
            }),
            this.prisma.goodsReceipt.count({ where }),
        ]);
        return {
            currency: this.currency.info,
            items: rows.map(({ items, ...grn }) => ({
                ...grn,
                lines: items.length,
                receivedUnits: items.reduce((s, i) => s + i.receivedQty, 0),
                rejectedUnits: items.reduce((s, i) => s + i.rejectedQty, 0),
                costTotal: this.currency.format(
                    items.reduce(
                        (s, i) =>
                            s +
                            (i.receivedQty - i.rejectedQty) * num(i.costPrice),
                        0,
                    ),
                ),
            })),
            total,
            page,
            limit,
        };
    }

    async receipt(storeId: bigint, id: bigint, lang?: string) {
        const grn = await this.prisma.goodsReceipt.findFirst({
            where: { id, storeId },
            include: { items: { orderBy: { id: "asc" } } },
        });
        if (!grn)
            throw new NotFoundException(
                this.t("inventory.errors.receiptNotFound"),
            );
        const listings = await this.prisma.storeProduct.findMany({
            where: { id: { in: grn.items.map((i) => i.storeProductId) } },
            select: {
                id: true,
                variant: { select: { sku: true } },
                product: {
                    select: {
                        translations: { select: { lang: true, title: true } },
                    },
                },
            },
        });
        const byId = new Map(listings.map((l) => [l.id.toString(), l]));
        const invoiceIds = ((grn.invoiceMediaIds as number[] | null) ?? []).map(
            (m) => BigInt(m),
        );
        const [invoices, edits] = await Promise.all([
            this.prisma.mediaFile.findMany({
                where: { id: { in: invoiceIds } },
                select: {
                    id: true,
                    mimeType: true,
                    sizeBytes: true,
                    originalName: true,
                    checksum: true,
                    metadata: true,
                    createdAt: true,
                    uploadedById: true,
                },
            }),
            this.prisma.approvalRequest.findMany({
                where: {
                    type: ApprovalType.GRN_EDIT,
                    targetType: "GoodsReceipt",
                    targetId: grn.id,
                },
                orderBy: { id: "desc" },
                select: {
                    id: true,
                    status: true,
                    note: true,
                    reviewNote: true,
                    payload: true,
                    createdAt: true,
                    reviewedAt: true,
                },
            }),
        ]);
        return {
            currency: this.currency.info,
            ...grn,
            /** Invoice files: open with GET /account/media/{id}/file; `metadata` = forensic checks of the original upload. */
            invoices: invoices.map((m) => ({
                ...m,
                file: MEDIA_ROUTES.file(m.id),
            })),
            editRequests: edits,
            items: grn.items.map((i) => {
                const l = byId.get(i.storeProductId.toString());
                return {
                    ...i,
                    sku: l?.variant.sku ?? null,
                    title: l
                        ? this.locale.pick(
                              this.rules.titleMap(l.product.translations),
                              lang,
                          )
                        : null,
                    mrp: this.currency.format(i.mrp),
                    costPrice: this.currency.formatOrNull(i.costPrice),
                };
            }),
        };
    }

    // ---------------------------------------------------------------------
    // Goods receipt corrections (admin approval)
    // ---------------------------------------------------------------------

    /**
     * Ask the admin to correct a posted goods receipt. Nothing changes until
     * approved; the receipt is marked EDIT_PENDING meanwhile.
     */
    async requestGrnEdit(
        storeId: bigint,
        grnId: bigint,
        dto: GrnEditRequestInput,
        actor: AuthUser,
    ) {
        const grn = await this.prisma.goodsReceipt.findFirst({
            where: { id: grnId, storeId },
            include: { items: true },
        });
        if (!grn)
            throw new NotFoundException(
                this.t("inventory.errors.receiptNotFound"),
            );
        const header = Object.fromEntries(
            Object.entries(dto.header ?? {}).filter(([, v]) => v !== undefined),
        );
        if (!Object.keys(header).length && !dto.items?.length)
            throw new BadRequestException({
                message: this.t("inventory.errors.nothingToChange"),
                code: "NOTHING_TO_CHANGE",
            });
        if (dto.header?.invoiceMediaIds)
            await this.assertInvoiceMedia(
                this.prisma,
                storeId,
                dto.header.invoiceMediaIds,
                grn.id,
            );

        const items = (dto.items ?? []).map((change) => {
            const item = grn.items.find((i) => i.id === BigInt(change.itemId));
            if (!item)
                throw new BadRequestException({
                    message: this.t("inventory.errors.grnItemNotFound", {
                        id: String(change.itemId),
                    }),
                    code: "GRN_ITEM_NOT_FOUND",
                });
            const received = change.receivedQty ?? item.receivedQty;
            const rejected = change.rejectedQty ?? item.rejectedQty;
            if (rejected > received)
                throw new BadRequestException(
                    this.t("inventory.errors.rejectedGtReceived"),
                );
            const { itemId, ...after } = change;
            return {
                itemId,
                after,
                before: {
                    receivedQty: item.receivedQty,
                    rejectedQty: item.rejectedQty,
                    rejectReason: item.rejectReason,
                    costPrice: item.costPrice,
                    manufacturedAt: item.manufacturedAt,
                    expiryDate: item.expiryDate,
                },
                acceptedDelta:
                    received - rejected - (item.receivedQty - item.rejectedQty),
            };
        });

        const request = await this.prisma.$transaction(async (tx) => {
            const r = await openApproval(tx, actor, {
                type: ApprovalType.GRN_EDIT,
                storeId,
                targetType: "GoodsReceipt",
                targetId: grn.id,
                note: dto.note,
                payload: { header, items },
                snapshot: {
                    grnNumber: grn.grnNumber,
                    header: {
                        supplierName: grn.supplierName,
                        supplierPhone: grn.supplierPhone,
                        supplierInvoiceNo: grn.supplierInvoiceNo,
                        supplierInvoiceDate: grn.supplierInvoiceDate,
                        invoiceMediaIds: grn.invoiceMediaIds,
                    },
                },
            });
            await tx.goodsReceipt.update({
                where: { id: grn.id },
                data: { status: GoodsReceiptStatus.EDIT_PENDING },
            });
            return r;
        });
        return {
            success: true,
            approvalId: request.id,
            status: request.status,
        };
    }

    /** Applies an approved goods-receipt correction: header, quantities (with stock movements), dates and cost. */
    async applyGrnEdit(
        tx: Tx,
        req: { targetId: bigint; id: bigint; payload: unknown },
        actor: AuthUser,
    ) {
        const payload = req.payload as {
            header: Record<string, unknown>;
            items: { itemId: number; after: Record<string, any> }[];
        };
        const grn = await tx.goodsReceipt.findUniqueOrThrow({
            where: { id: req.targetId },
            include: { items: true },
        });
        const tz = await this.cache.storeTz(tx, grn.storeId);
        const touched = new Set<bigint>();
        const applied: Record<string, unknown>[] = [];

        const h = payload.header ?? {};
        await tx.goodsReceipt.update({
            where: { id: grn.id },
            data: {
                ...(h.supplierName !== undefined && {
                    supplierName: h.supplierName as string,
                }),
                ...(h.supplierPhone !== undefined && {
                    supplierPhone: h.supplierPhone as string,
                }),
                ...(h.supplierInvoiceNo !== undefined && {
                    supplierInvoiceNo: h.supplierInvoiceNo as string,
                }),
                ...(h.supplierInvoiceDate !== undefined && {
                    supplierInvoiceDate: new Date(
                        h.supplierInvoiceDate as string,
                    ),
                }),
                ...(h.invoiceMediaIds !== undefined && {
                    invoiceMediaIds: h.invoiceMediaIds as Prisma.InputJsonValue,
                }),
                status: GoodsReceiptStatus.POSTED,
                editCount: { increment: 1 },
            },
        });

        for (const change of payload.items ?? []) {
            const item = grn.items.find((i) => i.id === BigInt(change.itemId))!;
            const a = change.after;
            const received = a.receivedQty ?? item.receivedQty;
            const rejected = a.rejectedQty ?? item.rejectedQty;
            const delta =
                received - rejected - (item.receivedQty - item.rejectedQty);
            const sp = await tx.storeProduct.findUniqueOrThrow({
                where: { id: item.storeProductId },
            });
            touched.add(sp.productId);
            const datesChanged =
                a.manufacturedAt !== undefined || a.expiryDate !== undefined;

            if (item.batchId) {
                const b = await tx.inventoryBatch.findUniqueOrThrow({
                    where: { id: item.batchId },
                });
                const sharedBy = await tx.goodsReceiptItem.count({
                    where: { batchId: b.id },
                });
                if (datesChanged && sharedBy > 1)
                    throw new ConflictException({
                        message: this.t("inventory.errors.grnSharedBatch", {
                            batch: b.batchNumber,
                        }),
                        code: "GRN_EDIT_SHARED_BATCH",
                    });
                if (b.availableQty + delta < 0)
                    throw new ConflictException({
                        message: this.t("inventory.errors.grnStockUsed", {
                            batch: b.batchNumber,
                        }),
                        code: "GRN_EDIT_STOCK_USED",
                    });

                const left = b.availableQty + delta;
                const expiry = a.expiryDate
                    ? new Date(a.expiryDate)
                    : b.expiryDate;
                const revive =
                    b.status === BatchStatus.DEPLETED &&
                    left > 0 &&
                    (!expiry || expiry >= todayInTz(tz));
                await tx.inventoryBatch.update({
                    where: { id: b.id },
                    data: {
                        receivedQty: { increment: delta },
                        availableQty: { increment: delta },
                        ...(b.status === BatchStatus.ACTIVE &&
                            left === 0 && { status: BatchStatus.DEPLETED }),
                        ...(revive && { status: BatchStatus.ACTIVE }),
                        ...(a.manufacturedAt !== undefined && {
                            manufacturedAt: new Date(a.manufacturedAt),
                        }),
                        ...(a.expiryDate !== undefined && {
                            expiryDate: new Date(a.expiryDate),
                        }),
                        ...(a.costPrice !== undefined &&
                            sharedBy === 1 && { costPrice: a.costPrice }),
                    },
                });
                if (delta !== 0) {
                    const counted = b.status === BatchStatus.ACTIVE || revive;
                    const balanceAfter = counted
                        ? await this.stock.bumpAvailable(tx, sp.id, delta)
                        : sp.availableQty;
                    if (counted && delta < 0)
                        await this.assertAboveReserved(tx, sp.id, balanceAfter);
                    await tx.stockMovement.create({
                        data: {
                            storeId: grn.storeId,
                            storeProductId: sp.id,
                            batchId: b.id,
                            type: StockMovementType.ADJUSTMENT,
                            quantity: delta,
                            balanceAfter,
                            batchBalanceAfter: left,
                            refType: "GRN_EDIT",
                            refId: grn.id,
                            actorId: actor.id,
                            note: `GRN ${grn.grnNumber} corrected (request #${req.id})`,
                        },
                    });
                }
                if (sp.trackBatches)
                    await this.stock.refreshMrp(tx, sp.id, actor.id, tz);
            } else if (delta !== 0) {
                const balanceAfter = await this.stock.bumpAvailable(
                    tx,
                    sp.id,
                    delta,
                );
                if (delta < 0)
                    await this.assertAboveReserved(tx, sp.id, balanceAfter);
                await tx.stockMovement.create({
                    data: {
                        storeId: grn.storeId,
                        storeProductId: sp.id,
                        type: StockMovementType.ADJUSTMENT,
                        quantity: delta,
                        balanceAfter,
                        refType: "GRN_EDIT",
                        refId: grn.id,
                        actorId: actor.id,
                        note: `GRN ${grn.grnNumber} corrected (request #${req.id})`,
                    },
                });
            }

            await tx.goodsReceiptItem.update({
                where: { id: item.id },
                data: {
                    receivedQty: received,
                    rejectedQty: rejected,
                    ...(a.rejectReason !== undefined && {
                        rejectReason: a.rejectReason,
                    }),
                    ...(a.costPrice !== undefined && {
                        costPrice: a.costPrice,
                    }),
                    ...(a.manufacturedAt !== undefined && {
                        manufacturedAt: new Date(a.manufacturedAt),
                    }),
                    ...(a.expiryDate !== undefined && {
                        expiryDate: new Date(a.expiryDate),
                    }),
                },
            });
            applied.push({ itemId: String(item.id), acceptedDelta: delta });
        }
        return { applied, touched };
    }

    private async assertAboveReserved(tx: Tx, spId: bigint, balance: number) {
        const { reservedQty } = await tx.storeProduct.findUniqueOrThrow({
            where: { id: spId },
            select: { reservedQty: true },
        });
        if (balance < reservedQty)
            throw new ConflictException({
                message: this.t("inventory.errors.belowReserved"),
                code: "BELOW_RESERVED",
            });
    }
}
