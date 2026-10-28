import { AuthUser } from "@common/types/auth.type";
import {
    addDays,
    num,
    pageParams,
    todayInTz,
} from "@common/utils/helpers.util";
import { AppConfig } from "@config/config.type";
import { CurrencyService } from "@core/currency/currency.service";
import { PrismaService } from "@core/database/prisma.service";
import { RedisService } from "@core/redis/redis.service";
import {
    AdjustStockInput,
    MovementInput,
    StockOutInput,
} from "./inventory.types";
import {
    BadRequestException,
    ConflictException,
    Injectable,
    Logger,
    NotFoundException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Prisma } from "@prisma-client/client";
import {
    BatchStatus,
    StockMovementType,
    StorePriceStatus,
} from "@prisma-client/enums";
import { I18nService } from "nestjs-i18n";
import { Tx, PickedBatch } from "./inventory.types";
import { isUniqueViolation } from "./inventory.util";
import { InventoryCacheService } from "./inventory-cache.service";

/** Stock on hand: reservations, FEFO picks, stock out / adjustments, batches, MRP refresh and the expiry sweep. */
@Injectable()
export class StockService {
    private readonly log = new Logger(StockService.name);
    private readonly defaultTz: string;
    private readonly settings: AppConfig["inventory"];

    constructor(
        private readonly prisma: PrismaService,
        private readonly redis: RedisService,
        private readonly config: ConfigService,
        private readonly i18n: I18nService,
        private readonly currency: CurrencyService,
        private readonly cache: InventoryCacheService,
    ) {
        this.defaultTz = this.config.getOrThrow<string>("app.timezone");
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
    // Atomic stock primitives (safe to call inside any transaction)
    // ---------------------------------------------------------------------

    /**
     * Atomically change StoreProduct.availableQty and return the new balance.
     * A DB CHECK constraint rejects negative balances.
     */
    async bumpAvailable(tx: Tx, spId: bigint, delta: number): Promise<number> {
        const rows = await tx.$queryRaw<{ availableQty: number }[]>`
            UPDATE "StoreProduct"
            SET "availableQty" = "availableQty" + ${delta}, "updatedAt" = now()
            WHERE id = ${spId}
            RETURNING "availableQty"`;
        if (!rows.length)
            throw new NotFoundException(
                this.t("inventory.errors.listingNotFound"),
            );
        return rows[0].availableQty;
    }

    /** Reserve stock only if (available - reserved) >= qty. Returns false when stock is insufficient. */
    async reserve(tx: Tx, spId: bigint, qty: number): Promise<boolean> {
        const updated = await tx.$executeRaw`
            UPDATE "StoreProduct"
            SET "reservedQty" = "reservedQty" + ${qty}, "updatedAt" = now()
            WHERE id = ${spId} AND "isActive" = true
              AND "availableQty" - "reservedQty" >= ${qty}`;
        return updated === 1;
    }

    /** Release a reservation; never drops below zero. */
    async release(tx: Tx, spId: bigint, qty: number) {
        await tx.$executeRaw`
            UPDATE "StoreProduct"
            SET "reservedQty" = GREATEST("reservedQty" - ${qty}, 0), "updatedAt" = now()
            WHERE id = ${spId}`;
    }

    /**
     * FEFO pick: earliest expiry first. Rows are locked with SKIP LOCKED so
     * parallel packers never fight over the same batch.
     * Throws BATCH_STOCK_UNAVAILABLE when the unlocked, sellable batches cannot cover `qty`.
     */
    async pickFefo(
        tx: Tx,
        spId: bigint,
        qty: number,
        minSellableDays: number,
        tz = this.defaultTz,
    ): Promise<PickedBatch[]> {
        const cutoff = addDays(todayInTz(tz), minSellableDays)
            .toISOString()
            .slice(0, 10);
        const rows = await tx.$queryRaw<any[]>`
            SELECT id, "batchNumber", mrp, "clearancePrice", "manufacturedAt", "expiryDate", "availableQty"
            FROM "InventoryBatch"
            WHERE "storeProductId" = ${spId}
              AND status = ${BatchStatus.ACTIVE}::"BatchStatus"
              AND "availableQty" > 0
              AND ("expiryDate" IS NULL OR "expiryDate" >= ${cutoff}::date)
            ORDER BY "expiryDate" ASC NULLS LAST, "receivedAt" ASC, id ASC
            FOR UPDATE SKIP LOCKED`;

        const picked: PickedBatch[] = [];
        let need = qty;
        for (const r of rows) {
            if (need <= 0) break;
            const take = Math.min(need, r.availableQty);
            picked.push({
                batchId: BigInt(r.id),
                batchNumber: r.batchNumber,
                mrp: num(r.mrp),
                clearancePrice:
                    r.clearancePrice == null ? null : num(r.clearancePrice),
                manufacturedAt: r.manufacturedAt,
                expiryDate: r.expiryDate,
                take,
            });
            need -= take;
        }
        if (need > 0)
            throw new ConflictException({
                message: this.t("inventory.errors.stockUnavailable"),
                code: "BATCH_STOCK_UNAVAILABLE",
            });
        return picked;
    }

    /**
     * Sync `currentMrp` with the batch FEFO would pick next and clamp
     * `sellingPrice` to it (legal MRP cap). Writes price history on change.
     */
    async refreshMrp(
        tx: Tx,
        spId: bigint,
        actorId?: bigint,
        tz = this.defaultTz,
    ) {
        const sp = await tx.storeProduct.findUniqueOrThrow({
            where: { id: spId },
            include: { variant: { select: { mrp: true } } },
        });
        const cutoff = addDays(todayInTz(tz), sp.minSellableDays);
        const head = sp.trackBatches
            ? await tx.inventoryBatch.findFirst({
                  where: {
                      storeProductId: spId,
                      status: BatchStatus.ACTIVE,
                      availableQty: { gt: 0 },
                      OR: [
                          { expiryDate: null },
                          { expiryDate: { gte: cutoff } },
                      ],
                  },
                  orderBy: [
                      { expiryDate: { sort: "asc", nulls: "last" } },
                      { receivedAt: "asc" },
                      { id: "asc" },
                  ],
              })
            : null;

        // No sellable batch: keep the last known MRP.
        const newMrp = head
            ? num(head.mrp)
            : num(sp.currentMrp ?? sp.variant.mrp);
        const newPrice = Math.min(num(sp.sellingPrice), newMrp);
        if (newMrp === num(sp.currentMrp) && newPrice === num(sp.sellingPrice))
            return;

        await tx.storeProduct.update({
            where: { id: spId },
            data: { currentMrp: newMrp, sellingPrice: newPrice },
        });
        await tx.storePriceHistory.create({
            data: {
                storeProductId: spId,
                oldPrice: sp.sellingPrice,
                newPrice,
                oldMrp: sp.currentMrp,
                newMrp,
                reason: "NEW_BATCH_MRP",
                changedById: actorId,
            },
        });
    }

    /**
     * Called by the catalogue (inside its transaction) whenever an admin
     * changes a variant's MRP. Every store price above the new MRP is
     * discarded: reset to the new MRP and flagged `MRP_RESET` so the store
     * manager can set a new price. Returns the affected store ids.
     */
    async applyCatalogMrpTx(
        tx: Tx,
        variantId: bigint,
        newMrp: number,
        actorId?: bigint,
    ): Promise<bigint[]> {
        const above = await tx.storeProduct.findMany({
            where: { variantId, sellingPrice: { gt: newMrp } },
            select: {
                id: true,
                storeId: true,
                sellingPrice: true,
                currentMrp: true,
            },
        });
        if (!above.length) return [];

        const now = new Date();
        await tx.storeProduct.updateMany({
            where: { id: { in: above.map((sp) => sp.id) } },
            data: {
                sellingPrice: newMrp,
                priceStatus: StorePriceStatus.MRP_RESET,
                priceResetAt: now,
            },
        });
        await tx.storePriceHistory.createMany({
            data: above.map((sp) => ({
                storeProductId: sp.id,
                oldPrice: sp.sellingPrice,
                newPrice: newMrp,
                oldMrp: sp.currentMrp,
                newMrp: sp.currentMrp,
                reason: "CATALOG_MRP_REDUCED",
                changedById: actorId,
            })),
        });
        this.log.log(
            `Variant ${variantId}: MRP lowered to ${newMrp}, reset price on ${above.length} store listing(s)`,
        );
        return [...new Set(above.map((sp) => sp.storeId))];
    }

    // ---------------------------------------------------------------------
    // Stock out & adjustments
    // ---------------------------------------------------------------------

    /**
     * Remove stock (damage, loss, expiry, vendor return...). Batch-tracked
     * lines without `batchId` are taken FEFO. All lines succeed or none.
     * Idempotent when `idempotencyKey` is sent.
     */
    async stockOut(storeId: bigint, dto: StockOutInput, actor: AuthUser) {
        const firstKey = dto.idempotencyKey
            ? `${dto.idempotencyKey}#0`
            : undefined;
        if (
            firstKey &&
            (await this.prisma.stockMovement.findUnique({
                where: { idempotencyKey: firstKey },
            }))
        )
            return { duplicate: true as const };

        const tz = await this.cache.storeTz(this.prisma, storeId);
        const touched = new Set<bigint>();
        let seq = 0;
        const nextKey = () =>
            dto.idempotencyKey ? `${dto.idempotencyKey}#${seq++}` : undefined;

        try {
            const lines = await this.prisma.$transaction(async (tx) => {
                const result: {
                    storeProductId: bigint;
                    removed: number;
                    balanceAfter: number;
                    batches: {
                        batchId: bigint;
                        batchNumber: string;
                        quantity: number;
                    }[];
                }[] = [];

                for (const item of dto.items) {
                    const sp = await tx.storeProduct.findFirst({
                        where: { id: BigInt(item.storeProductId), storeId },
                    });
                    if (!sp)
                        throw new NotFoundException(
                            this.t("inventory.errors.listingNotInStore", {
                                id: String(item.storeProductId),
                            }),
                        );
                    touched.add(sp.productId);

                    const base = {
                        storeId,
                        storeProductId: sp.id,
                        type: dto.reason,
                        actorId: actor.id,
                        note: dto.note,
                        refType: "STOCK_OUT",
                    };
                    const takenBatches: {
                        batchId: bigint;
                        batchNumber: string;
                        quantity: number;
                    }[] = [];
                    let balanceAfter = sp.availableQty;
                    let countedOut = 0;

                    if (sp.trackBatches) {
                        // Explicit batch, or FEFO over the sellable batches.
                        const picks: {
                            batchId: bigint;
                            batchNumber: string;
                            take: number;
                        }[] = item.batchId
                            ? [
                                  {
                                      batchId: BigInt(item.batchId),
                                      batchNumber: "",
                                      take: item.quantity,
                                  },
                              ]
                            : await this.pickFefo(
                                  tx,
                                  sp.id,
                                  item.quantity,
                                  0,
                                  tz,
                              );

                        for (const pick of picks) {
                            const b = await tx.inventoryBatch.findFirst({
                                where: {
                                    id: pick.batchId,
                                    storeProductId: sp.id,
                                },
                            });
                            if (!b)
                                throw new NotFoundException(
                                    this.t("inventory.errors.batchNotFound"),
                                );
                            if (b.availableQty < pick.take)
                                throw new BadRequestException(
                                    this.t("inventory.errors.batchNegative"),
                                );
                            const left = b.availableQty - pick.take;
                            await tx.inventoryBatch.update({
                                where: { id: b.id },
                                data: {
                                    availableQty: { decrement: pick.take },
                                    ...(left === 0 &&
                                        b.status === BatchStatus.ACTIVE && {
                                            status: BatchStatus.DEPLETED,
                                        }),
                                },
                            });
                            // Only ACTIVE batches are counted in the store balance.
                            if (b.status === BatchStatus.ACTIVE) {
                                balanceAfter = await this.bumpAvailable(
                                    tx,
                                    sp.id,
                                    -pick.take,
                                );
                                countedOut += pick.take;
                            }
                            await tx.stockMovement.create({
                                data: {
                                    ...base,
                                    batchId: b.id,
                                    quantity: -pick.take,
                                    balanceAfter,
                                    batchBalanceAfter: left,
                                    idempotencyKey: nextKey(),
                                },
                            });
                            takenBatches.push({
                                batchId: b.id,
                                batchNumber: b.batchNumber,
                                quantity: pick.take,
                            });
                        }
                    } else {
                        balanceAfter = await this.bumpAvailable(
                            tx,
                            sp.id,
                            -item.quantity,
                        );
                        countedOut = item.quantity;
                        await tx.stockMovement.create({
                            data: {
                                ...base,
                                quantity: -item.quantity,
                                balanceAfter,
                                idempotencyKey: nextKey(),
                            },
                        });
                    }

                    // Never take away stock that open orders have reserved.
                    if (countedOut > 0) {
                        const { reservedQty } =
                            await tx.storeProduct.findUniqueOrThrow({
                                where: { id: sp.id },
                                select: { reservedQty: true },
                            });
                        if (balanceAfter < reservedQty)
                            throw new ConflictException({
                                message: this.t(
                                    "inventory.errors.belowReserved",
                                ),
                                code: "BELOW_RESERVED",
                                storeProductId: sp.id,
                            });
                    }
                    if (sp.trackBatches)
                        await this.refreshMrp(tx, sp.id, actor.id, tz);

                    result.push({
                        storeProductId: sp.id,
                        removed: item.quantity,
                        balanceAfter,
                        batches: takenBatches,
                    });
                }
                return result;
            });
            await this.cache.invalidateProducts(touched);
            return { success: true, reason: dto.reason, lines };
        } catch (e) {
            if (dto.idempotencyKey && isUniqueViolation(e))
                return { duplicate: true as const };
            throw e;
        }
    }

    /**
     * Manual stock correction (count fix, damage, loss...). Only ADJUSTMENT may add stock.
     * Idempotent when `dto.idempotencyKey` is supplied.
     */
    async adjust(storeId: bigint, dto: AdjustStockInput, actor: AuthUser) {
        if (dto.delta === 0)
            throw new BadRequestException(this.t("inventory.errors.deltaZero"));
        if (dto.type !== StockMovementType.ADJUSTMENT && dto.delta > 0)
            throw new BadRequestException(
                this.t("inventory.errors.typeMustBeNegative", {
                    type: dto.type,
                }),
            );

        let productId: bigint | undefined;
        try {
            const result = await this.prisma.$transaction(async (tx) => {
                if (
                    dto.idempotencyKey &&
                    (await tx.stockMovement.findUnique({
                        where: { idempotencyKey: dto.idempotencyKey },
                    }))
                )
                    return { duplicate: true as const };

                const sp = await tx.storeProduct.findFirst({
                    where: { id: BigInt(dto.storeProductId), storeId },
                });
                if (!sp)
                    throw new NotFoundException(
                        this.t("inventory.errors.notFound"),
                    );
                productId = sp.productId;

                // Fields shared by every movement row written below.
                const movement = {
                    storeId,
                    storeProductId: sp.id,
                    type: dto.type,
                    quantity: dto.delta,
                    actorId: actor.id,
                    note: dto.note,
                    idempotencyKey: dto.idempotencyKey,
                };

                let batchId: bigint | null = null;
                let batchQty: number | undefined;
                if (sp.trackBatches) {
                    if (!dto.batchId)
                        throw new BadRequestException(
                            this.t("inventory.errors.batchIdRequired"),
                        );
                    const b = await tx.inventoryBatch.findFirst({
                        where: {
                            id: BigInt(dto.batchId),
                            storeProductId: sp.id,
                        },
                    });
                    if (!b)
                        throw new NotFoundException(
                            this.t("inventory.errors.batchNotFound"),
                        );
                    const newQty = b.availableQty + dto.delta;
                    if (newQty < 0)
                        throw new BadRequestException(
                            this.t("inventory.errors.batchNegative"),
                        );

                    const reactivate =
                        b.status === BatchStatus.DEPLETED && newQty > 0;
                    const nextStatus =
                        b.status === BatchStatus.ACTIVE && newQty === 0
                            ? BatchStatus.DEPLETED
                            : reactivate
                              ? BatchStatus.ACTIVE
                              : undefined;
                    const nb = await tx.inventoryBatch.update({
                        where: { id: b.id },
                        data: {
                            availableQty: { increment: dto.delta },
                            status: nextStatus,
                        },
                    });
                    batchId = b.id;
                    batchQty = nb.availableQty;

                    // Quarantined/expired/damaged stock isn't in the store balance: log only.
                    if (b.status !== BatchStatus.ACTIVE && !reactivate) {
                        await tx.stockMovement.create({
                            data: {
                                ...movement,
                                batchId,
                                balanceAfter: sp.availableQty,
                                batchBalanceAfter: batchQty,
                            },
                        });
                        return { storeQty: sp.availableQty, batchQty };
                    }
                }

                const storeQty = await this.bumpAvailable(tx, sp.id, dto.delta);
                // Our UPDATE holds the row lock, so this read of reservedQty cannot go stale.
                if (dto.delta < 0) {
                    const { reservedQty } =
                        await tx.storeProduct.findUniqueOrThrow({
                            where: { id: sp.id },
                            select: { reservedQty: true },
                        });
                    if (storeQty < reservedQty)
                        throw new ConflictException(
                            this.t("inventory.errors.belowReserved"),
                        );
                }

                await tx.stockMovement.create({
                    data: {
                        ...movement,
                        batchId,
                        balanceAfter: storeQty,
                        batchBalanceAfter: batchQty,
                    },
                });
                if (sp.trackBatches)
                    await this.refreshMrp(
                        tx,
                        sp.id,
                        actor.id,
                        await this.cache.storeTz(tx, storeId),
                    );
                return { storeQty, batchQty };
            });
            if (productId) await this.cache.invalidateProducts([productId]);
            return result;
        } catch (e) {
            // Concurrent retry with the same key: the unique index rejected the loser.
            if (dto.idempotencyKey && isUniqueViolation(e))
                return { duplicate: true as const };
            throw e;
        }
    }

    /**
     * Change a batch's status (approve quarantine, recall, damage...).
     * Keeps StoreProduct.availableQty consistent: only ACTIVE batches are counted.
     */
    async setBatchStatus(
        storeId: bigint,
        batchId: bigint,
        status: BatchStatus,
        clearancePrice: number | undefined,
        actor: AuthUser,
    ) {
        let productId: bigint | undefined;
        const res = await this.prisma.$transaction(async (tx) => {
            const b = await tx.inventoryBatch.findFirst({
                where: { id: batchId, storeId },
                include: { storeProduct: { select: { productId: true } } },
            });
            if (!b)
                throw new NotFoundException(
                    this.t("inventory.errors.notFound"),
                );
            productId = b.storeProduct.productId;

            if (clearancePrice != null && clearancePrice > num(b.mrp))
                throw new BadRequestException(
                    this.t("inventory.errors.clearanceGtMrp"),
                );

            const tz = await this.cache.storeTz(tx, storeId);
            // An already-expired batch must never be put on sale.
            if (
                status === BatchStatus.ACTIVE &&
                b.expiryDate &&
                b.expiryDate < todayInTz(tz)
            )
                throw new BadRequestException(
                    this.t("inventory.errors.batchExpired", {
                        batch: b.batchNumber,
                    }),
                );

            await tx.inventoryBatch.update({
                where: { id: b.id },
                data: { status, clearancePrice },
            });

            const wasCounted = b.status === BatchStatus.ACTIVE;
            const willCount = status === BatchStatus.ACTIVE;
            if (wasCounted !== willCount && b.availableQty > 0) {
                const delta = willCount ? b.availableQty : -b.availableQty;
                const balanceAfter = await this.bumpAvailable(
                    tx,
                    b.storeProductId,
                    delta,
                );
                await tx.stockMovement.create({
                    data: {
                        storeId,
                        storeProductId: b.storeProductId,
                        batchId: b.id,
                        type:
                            status === BatchStatus.DAMAGED
                                ? StockMovementType.DAMAGE
                                : status === BatchStatus.EXPIRED
                                  ? StockMovementType.EXPIRED
                                  : StockMovementType.ADJUSTMENT,
                        quantity: delta,
                        balanceAfter,
                        batchBalanceAfter: b.availableQty,
                        actorId: actor.id,
                        note: this.t("inventory.notes.batchStatusChange", {
                            from: b.status,
                            to: status,
                        }),
                    },
                });
            }
            await this.refreshMrp(tx, b.storeProductId, actor.id, tz);
            return { success: true };
        });
        if (productId) await this.cache.invalidateProducts([productId]);
        return res;
    }

    // ---------------------------------------------------------------------
    // Barcode
    // ---------------------------------------------------------------------

    /** Resolve a barcode to its variant and this store's listing (if any). */
    async scan(storeId: bigint, code: string) {
        const bc = await this.prisma.productBarcode.findUnique({
            where: { code: code.trim() },
            include: {
                variant: {
                    include: {
                        product: {
                            include: {
                                translations: {
                                    select: { lang: true, title: true },
                                },
                            },
                        },
                    },
                },
            },
        });
        if (!bc)
            throw new NotFoundException({
                message: this.t("inventory.errors.unknownBarcode"),
                code: "BARCODE_UNKNOWN",
            });

        const sp = await this.prisma.storeProduct.findUnique({
            where: { storeId_variantId: { storeId, variantId: bc.variantId } },
        });
        return {
            barcode: bc.code,
            variantId: bc.variantId,
            sku: bc.variant.sku,
            mrp: this.currency.format(bc.variant.mrp),
            productId: bc.variant.productId,
            titles: bc.variant.product.translations,
            listing: sp
                ? {
                      ...sp,
                      sellingPrice: this.currency.format(sp.sellingPrice),
                      sellable: sp.availableQty - sp.reservedQty,
                  }
                : null,
            currency: this.currency.info,
        };
    }

    async listBatches(storeId: bigint, storeProductId: bigint) {
        const rows = await this.prisma.inventoryBatch.findMany({
            where: { storeId, storeProductId },
            orderBy: [
                { expiryDate: { sort: "asc", nulls: "last" } },
                { id: "asc" },
            ],
        });
        return rows.map((b) => ({
            ...b,
            mrp: this.currency.format(b.mrp),
            costPrice: this.currency.formatOrNull(b.costPrice),
            clearancePrice: this.currency.formatOrNull(b.clearancePrice),
        }));
    }

    /**
     * Record a stock movement inside the current transaction.
     *
     * This is intentionally transaction-aware so callers can update stock
     * and create the corresponding ledger entry atomically.
     */
    async movement(tx: Tx, data: Prisma.StockMovementUncheckedCreateInput) {
        return tx.stockMovement.create({
            data,
        });
    }

    movements(storeId: bigint, storeProductId: bigint, query: MovementInput) {
        const { take, skip } = pageParams(query);
        return this.prisma.stockMovement.findMany({
            where: { storeId, storeProductId },
            orderBy: { id: "desc" },
            take,
            skip,
        });
    }

    // ---------------------------------------------------------------------
    // Expiry sweep
    // ---------------------------------------------------------------------

    /** Mark past-expiry batches as EXPIRED and remove their stock from the store balance. */
    async expirySweep() {
        // Distributed lock so only one instance runs the sweep.
        const unlock = await this.redis.lock(
            "cron:expiry",
            this.settings.sweepLockTtlSec,
        );
        if (!unlock) return;

        try {
            // Coarse DB filter: +1 day covers stores ahead of the default timezone.
            // The exact per-store check happens in memory below.
            const candidates = await this.prisma.inventoryBatch.findMany({
                where: {
                    status: {
                        in: [BatchStatus.ACTIVE, BatchStatus.QUARANTINE],
                    },
                    expiryDate: { lt: addDays(todayInTz(this.defaultTz), 1) },
                },
                orderBy: { expiryDate: "asc" }, // oldest first so the batch limit can't starve them
                include: { storeProduct: { select: { productId: true } } },
                take: this.settings.sweepBatchSize,
            });

            const stores = await this.prisma.store.findMany({
                where: {
                    id: { in: [...new Set(candidates.map((b) => b.storeId))] },
                },
                select: { id: true, timezone: true },
            });
            const tzById = new Map(stores.map((s) => [s.id, s.timezone]));
            const tzOf = (storeId: bigint) =>
                tzById.get(storeId) ?? this.defaultTz;

            const due = candidates.filter(
                (b) =>
                    b.expiryDate && b.expiryDate < todayInTz(tzOf(b.storeId)),
            );

            let expired = 0;
            for (const b of due) {
                try {
                    // One transaction per batch: a failure only skips that batch.
                    const done = await this.prisma.$transaction(async (tx) => {
                        const cur = await tx.inventoryBatch.findUnique({
                            where: { id: b.id },
                        });
                        // Re-read under the transaction: another worker may have handled it.
                        if (!cur || cur.status === BatchStatus.EXPIRED)
                            return false;

                        await tx.inventoryBatch.update({
                            where: { id: b.id },
                            data: { status: BatchStatus.EXPIRED },
                        });
                        // Only ACTIVE stock was counted in the store balance.
                        if (
                            cur.status === BatchStatus.ACTIVE &&
                            cur.availableQty > 0
                        ) {
                            const balanceAfter = await this.bumpAvailable(
                                tx,
                                b.storeProductId,
                                -cur.availableQty,
                            );
                            await tx.stockMovement.create({
                                data: {
                                    storeId: b.storeId,
                                    storeProductId: b.storeProductId,
                                    batchId: b.id,
                                    type: StockMovementType.EXPIRED,
                                    quantity: -cur.availableQty,
                                    balanceAfter,
                                    batchBalanceAfter: cur.availableQty,
                                    note: this.t("inventory.notes.expirySweep"),
                                },
                            });
                        }
                        await this.refreshMrp(
                            tx,
                            b.storeProductId,
                            undefined,
                            tzOf(b.storeId),
                        );
                        return true;
                    });
                    if (done) {
                        expired++; // counted only after a successful commit
                        await this.cache.invalidateProducts([
                            b.storeProduct.productId,
                        ]);
                    }
                } catch (e) {
                    this.log.warn(
                        `expiry sweep failed for batch ${b.id}: ${(e as Error).message}`,
                    );
                }
            }
            if (expired) this.log.log(`Expired ${expired} batches`);
        } finally {
            await unlock();
        }
    }
}
