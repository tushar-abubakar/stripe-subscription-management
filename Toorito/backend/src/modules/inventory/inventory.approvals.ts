import { ApprovalHandler } from "@modules/approvals/approvals.repo";
import { Injectable } from "@nestjs/common";
import {
    ApprovalType,
    BarcodeType,
    GoodsReceiptStatus,
    StoreListingStatus,
} from "@prisma-client/enums";
import { InventoryCacheService } from "./inventory-cache.service";
import { ListingRulesService } from "./listing-rules.service";
import { ReceiptService } from "./receipt.service";

/** Approval handlers owned by inventory (barcodes, goods-receipt corrections), registered with ApprovalsService. */
@Injectable()
export class InventoryApprovals {
    constructor(
        private readonly cache: InventoryCacheService,
        private readonly receipts: ReceiptService,
        private readonly rules: ListingRulesService,
    ) {}

    /** Approval handlers owned by inventory (barcodes, goods-receipt corrections). */
    handlers(): Partial<Record<ApprovalType, ApprovalHandler>> {
        return {
            [ApprovalType.BARCODE_ADD]: async (tx, req, { approve }) => {
                const p = req.payload as {
                    variantId: string;
                    barcodes: { code: string; type: BarcodeType }[];
                    gate: boolean;
                    requestedStatus: StoreListingStatus | null;
                    publishAt: string | null;
                };
                const variantId = BigInt(p.variantId);
                const added: string[] = [];
                const conflicts: string[] = [];
                if (approve) {
                    let hasAny =
                        (await tx.productBarcode.count({
                            where: { variantId },
                        })) > 0;
                    for (const b of p.barcodes) {
                        const taken = await tx.productBarcode.findUnique({
                            where: { code: b.code },
                        });
                        if (taken) {
                            if (taken.variantId !== variantId)
                                conflicts.push(b.code);
                            continue;
                        }
                        await tx.productBarcode.create({
                            data: {
                                variantId,
                                code: b.code,
                                type: b.type,
                                isPrimary: !hasAny,
                            },
                        });
                        hasAny = true;
                        added.push(b.code);
                    }
                }

                // A listing created with this request leaves PENDING_APPROVAL now.
                const sp = await tx.storeProduct.findUnique({
                    where: { id: req.targetId },
                    include: {
                        variant: {
                            select: { isActive: true, deletedAt: true },
                        },
                        product: { select: { status: true, deletedAt: true } },
                    },
                });
                let listingStatus: StoreListingStatus | null = null;
                if (
                    sp &&
                    p.gate &&
                    sp.status === StoreListingStatus.PENDING_APPROVAL
                ) {
                    let next: {
                        status: StoreListingStatus;
                        publishAt: Date | null;
                        isActive: boolean;
                    } = {
                        status: StoreListingStatus.DRAFT,
                        publishAt: null,
                        isActive: false,
                    };
                    if (approve && p.requestedStatus) {
                        const live = this.rules.catalogLive(
                            sp.variant,
                            sp.product,
                        );
                        const wanted = p.requestedStatus;
                        const at = p.publishAt ? new Date(p.publishAt) : null;
                        if (
                            (wanted === StoreListingStatus.ACTIVE ||
                                wanted === StoreListingStatus.SCHEDULED) &&
                            !live
                        )
                            next = {
                                status: StoreListingStatus.INACTIVE,
                                publishAt: null,
                                isActive: false,
                            };
                        else if (
                            wanted === StoreListingStatus.SCHEDULED &&
                            at &&
                            at > new Date()
                        )
                            next = {
                                status: wanted,
                                publishAt: at,
                                isActive: false,
                            };
                        else if (
                            wanted === StoreListingStatus.ACTIVE ||
                            wanted === StoreListingStatus.SCHEDULED
                        )
                            next = {
                                status: StoreListingStatus.ACTIVE,
                                publishAt: null,
                                isActive: true,
                            };
                        else
                            next = {
                                status: wanted,
                                publishAt: null,
                                isActive: false,
                            };
                    }
                    await tx.storeProduct.update({
                        where: { id: sp.id },
                        data: next,
                    });
                    listingStatus = next.status;
                }
                return {
                    result: { added, conflicts, listingStatus },
                    afterCommit: () =>
                        sp
                            ? this.cache.invalidateProducts([sp.productId])
                            : Promise.resolve(),
                };
            },
            [ApprovalType.GRN_EDIT]: async (tx, req, { approve, actor }) => {
                if (!approve) {
                    await tx.goodsReceipt.update({
                        where: { id: req.targetId },
                        data: { status: GoodsReceiptStatus.POSTED },
                    });
                    return { result: { applied: [] } };
                }
                const { applied, touched } = await this.receipts.applyGrnEdit(
                    tx,
                    req,
                    actor,
                );
                return {
                    result: { applied },
                    afterCommit: () => this.cache.invalidateProducts(touched),
                };
            },
        };
    }
}
