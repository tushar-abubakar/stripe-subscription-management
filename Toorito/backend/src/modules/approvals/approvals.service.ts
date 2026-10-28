import { MEDIA_ROUTES } from "@modules/media/media.routes";
import { isAdminRole } from "@common/authorization/permissions";
import { AuthUser } from "@common/types/auth.type";
import { pageParams } from "@common/utils/helpers.util";
import { PrismaService } from "@core/database/prisma.service";
import { LocaleService } from "@core/locale/locale.service";
import { ApprovalHandler } from "./approvals.repo";
import {
    AdminApprovalListInput,
    ApprovalListInput,
    DecisionInput,
    StoreApprovalListInput,
} from "./approvals.types";
import { ReturnsService } from "./returns.service";
import {
    CatalogBrowseService,
} from "@modules/inventory/catalog-browse.service";
import { KycService } from "@modules/kyc/kyc.service";
import {
    NotificationsService,
} from "@modules/notifications/notifications.service";
import { UsersService } from "@modules/users/users.service";
import {
    BadRequestException,
    ConflictException,
    ForbiddenException,
    Injectable,
    Logger,
    NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma-client/client";
import {
    ApprovalLevel,
    ApprovalRequestStatus,
    ApprovalType,
    UserRole,
} from "@prisma-client/enums";
import { I18nService } from "nestjs-i18n";
import { InventoryApprovals } from "@modules/inventory/inventory.approvals";

type Request = Prisma.ApprovalRequestGetPayload<object>;

/** Cancelling these must undo what opening them did (GRN EDIT_PENDING, listing PENDING_APPROVAL). */
const REVERT_ON_CANCEL: ApprovalType[] = [ApprovalType.GRN_EDIT, ApprovalType.BARCODE_ADD];

/**
 * One inbox for every decision. Requests are opened by the domain modules
 * (approvals.repo.openApproval); this service lists them, checks who may
 * decide, and runs the domain handler + status change in ONE transaction
 * (side effects such as refunds / notifications run after commit).
 */
@Injectable()
export class ApprovalsService {
    private readonly log = new Logger(ApprovalsService.name);
    private readonly handlers: Partial<Record<ApprovalType, ApprovalHandler>>;

    constructor(
        private readonly prisma: PrismaService,
        private readonly notify: NotificationsService,
        private readonly i18n: I18nService,
        private readonly locale: LocaleService,
        private readonly returns: ReturnsService,
        inventoryApprovals: InventoryApprovals,
        kyc: KycService,
        users: UsersService,
        private readonly catalogBrowse: CatalogBrowseService,
    ) {
        this.handlers = {
            ...inventoryApprovals.handlers(),
            ...kyc.handlers(),
            ...users.handlers(),
            ...returns.handlers(),
            ...catalogBrowse.handlers(),
        };
    }

    private t(key: string, args?: Record<string, unknown>) {
        return this.i18n.translate(`approvals.${key}`, args ? { args } : {}) as string;
    }

    // ---------------------------------------------------------------------
    // Lists
    // ---------------------------------------------------------------------

    private async page(where: Prisma.ApprovalRequestWhereInput, q: ApprovalListInput) {
        const { take, skip, page, limit } = pageParams(q);
        const [rows, total] = await Promise.all([
            this.prisma.approvalRequest.findMany({ where, orderBy: { id: "desc" }, take, skip }),
            this.prisma.approvalRequest.count({ where }),
        ]);
        return { items: await this.decorate(rows), total, page, limit };
    }

    /** Adds requester / reviewer / store labels (the table has no FKs on purpose). */
    private async decorate(rows: Request[]) {
        const userIds = [...new Set(rows.flatMap((r) => [r.requestedById, ...(r.reviewedById ? [r.reviewedById] : [])]))];
        const storeIds = [...new Set(rows.map((r) => r.storeId).filter((id): id is bigint => id != null))];
        const [users, stores] = await Promise.all([
            this.prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true, role: true } }),
            this.prisma.store.findMany({ where: { id: { in: storeIds } }, select: { id: true, code: true, name: true } }),
        ]);
        const u = new Map(users.map((x) => [x.id.toString(), x]));
        const s = new Map(stores.map((x) => [x.id.toString(), { ...x, name: this.locale.pick(x.name) }]));
        return rows.map((r) => ({
            ...r,
            requestedBy: u.get(r.requestedById.toString()) ?? null,
            reviewedBy: r.reviewedById ? (u.get(r.reviewedById.toString()) ?? null) : null,
            store: r.storeId ? (s.get(r.storeId.toString()) ?? null) : null,
        }));
    }

    adminList(q: AdminApprovalListInput) {
        return this.page(
            {
                ...(q.level !== "ALL" && { level: q.level === "STORE" ? ApprovalLevel.STORE : ApprovalLevel.ADMIN }),
                status: q.status ?? ApprovalRequestStatus.PENDING,
                ...(q.type && { type: q.type }),
                ...(q.storeId && { storeId: BigInt(q.storeId) }),
            },
            q,
        );
    }

    /** inbox = store decides (returns / exchanges); outbox = sent by the store to the admin. */
    storeList(storeId: bigint, q: StoreApprovalListInput) {
        return this.page(
            {
                storeId,
                level: q.box === "outbox" ? ApprovalLevel.ADMIN : ApprovalLevel.STORE,
                status: q.status ?? (q.box === "outbox" ? undefined : ApprovalRequestStatus.PENDING),
                ...(q.type && { type: q.type }),
            },
            q,
        );
    }

    mine(user: AuthUser, q: ApprovalListInput) {
        return this.page(
            { requestedById: user.id, ...(q.status && { status: q.status }), ...(q.type && { type: q.type }) },
            q,
        );
    }

    async summary(scope: { storeId?: bigint }) {
        const rows = await this.prisma.approvalRequest.groupBy({
            by: ["type", "level"],
            where: { status: ApprovalRequestStatus.PENDING, ...(scope.storeId && { storeId: scope.storeId }) },
            _count: { _all: true },
        });
        const pick = (level: ApprovalLevel) =>
            Object.fromEntries(rows.filter((r) => r.level === level).map((r) => [r.type, r._count._all]));
        return scope.storeId
            ? { inbox: pick(ApprovalLevel.STORE), outbox: pick(ApprovalLevel.ADMIN) }
            : { admin: pick(ApprovalLevel.ADMIN), store: pick(ApprovalLevel.STORE) };
    }

    // ---------------------------------------------------------------------
    // Detail
    // ---------------------------------------------------------------------

    /** Who may see a request: admins; the store it belongs to (managers); the requester. */
    private canView(r: Request, viewer: AuthUser) {
        if (isAdminRole(viewer.role)) return true;
        if (viewer.role === UserRole.STORE_MANAGER && r.storeId && r.storeId === viewer.storeId) return true;
        return r.requestedById === viewer.id;
    }

    async get(id: bigint, viewer: AuthUser) {
        const r = await this.prisma.approvalRequest.findUnique({ where: { id } });
        if (!r || !this.canView(r, viewer)) throw new NotFoundException(this.t("errors.notFound"));
        const [decorated] = await this.decorate([r]);
        return { ...decorated, target: await this.target(r, viewer) };
    }

    /** What the request is about, with forensic data of attached evidence. */
    private async target(r: Request, viewer: AuthUser) {
        const admin = isAdminRole(viewer.role);
        const mediaOf = async (ids: (bigint | number | string)[]) =>
            this.prisma.mediaFile.findMany({
                      where: { id: { in: ids.map((i) => BigInt(i)) } },
                      select: { id: true, purpose: true, mimeType: true, sizeBytes: true, width: true, height: true, checksum: true, metadata: true, createdAt: true, uploadedById: true },
                  });
        switch (r.targetType) {
            case "User": {
                const user = await this.prisma.user.findUnique({
                    where: { id: r.targetId },
                    select: { id: true, name: true, phone: true, role: true, approvalStatus: true, storeId: true, staffDuties: true, partnerProfile: { select: { vehicleType: true, vehicleNumber: true, kycStatus: true } } },
                });
                const docs = await this.prisma.kycDocument.findMany({
                    where: { userId: r.targetId, removedAt: null, submittedAt: { not: null } },
                    select: { id: true, type: true, title: true, status: true, documentNumber: true, expiresAt: true, frontMediaId: true, backMediaId: true },
                });
                const media = await mediaOf(docs.flatMap((d) => [d.frontMediaId, ...(d.backMediaId ? [d.backMediaId] : [])]));
                const meta = new Map(media.map((m) => [m.id.toString(), m.metadata]));
                return {
                    user,
                    kyc: docs.map(({ frontMediaId, backMediaId, ...d }) => ({
                        ...d,
                        // Files only for admins (the store never opens KYC files).
                        ...(admin && { frontFile: MEDIA_ROUTES.file(frontMediaId), backFile: backMediaId ? MEDIA_ROUTES.file(backMediaId) : null }),
                        forensics: { front: meta.get(frontMediaId.toString()) ?? null, back: backMediaId ? (meta.get(backMediaId.toString()) ?? null) : null },
                    })),
                };
            }
            case "KycDocument": {
                const doc = await this.prisma.kycDocument.findUnique({
                    where: { id: r.targetId },
                    include: { user: { select: { id: true, name: true, role: true, storeId: true } } },
                });
                if (!doc) return null;
                const media = await mediaOf([doc.frontMediaId, ...(doc.backMediaId ? [doc.backMediaId] : [])]);
                const { frontMediaId, backMediaId, ...rest } = doc;
                return {
                    ...rest,
                    ...(admin && { frontFile: MEDIA_ROUTES.file(frontMediaId), backFile: backMediaId ? MEDIA_ROUTES.file(backMediaId) : null }),
                    forensics: media.map((m) => ({ id: admin ? m.id : undefined, metadata: m.metadata })),
                };
            }
            case "StoreProduct": {
                const sp = await this.prisma.storeProduct.findUnique({
                    where: { id: r.targetId },
                    select: {
                        id: true,
                        status: true,
                        variant: { select: { id: true, sku: true, barcodes: { select: { code: true, type: true, isPrimary: true } } } },
                        product: { select: { id: true, slug: true, translations: { select: { lang: true, title: true } } } },
                    },
                });
                return sp ? { ...sp, product: { ...sp.product, title: this.locale.pick(Object.fromEntries(sp.product.translations.map((t) => [t.lang, t.title]))) } } : null;
            }
            case "GoodsReceipt": {
                const grn = await this.prisma.goodsReceipt.findUnique({ where: { id: r.targetId }, include: { items: true } });
                if (!grn) return null;
                const invoices = await mediaOf((grn.invoiceMediaIds as number[]) ?? []);
                return { ...grn, invoices: invoices.map((m) => ({ ...m, file: MEDIA_ROUTES.file(m.id) })) };
            }
            case "Order": {
                const order = await this.prisma.order.findUnique({
                    where: { id: r.targetId },
                    select: {
                        id: true, orderNumber: true, status: true, paymentMethod: true, paymentStatus: true, total: true, deliveredAt: true, userId: true,
                        items: { where: { parentId: null }, select: { id: true, title: true, sku: true, variantLabel: true, quantity: true, returnedQty: true, unitPrice: true, lineTotal: true } },
                    },
                });
                const ids = ((r.payload as { mediaIds?: number[] })?.mediaIds ?? []).map((m) => BigInt(m));
                const media = await mediaOf(ids);
                return {
                    order: order && { ...order, items: order.items.map((i) => ({ ...i, title: this.locale.pick(i.title) })) },
                    // Evidence photos: `/account/media/{id}/file` (store of the order + admins), with forensic flags.
                    evidence: media.map((m) => ({ ...m, file: MEDIA_ROUTES.file(m.id) })),
                };
            }
            case "Product":
            case "ProductVariant":
                // Current catalogue product (gallery + variation media) and the store's suggested files.
                return this.catalogBrowse.changeTarget(r);
            default:
                return null;
        }
    }

    // ---------------------------------------------------------------------
    // Decisions
    // ---------------------------------------------------------------------

    /** ADMIN-level: admins only. STORE-level: the store's manager, or an admin (override). */
    private assertCanDecide(r: Request, actor: AuthUser) {
        if (isAdminRole(actor.role)) return;
        if (
            r.level === ApprovalLevel.STORE &&
            actor.role === UserRole.STORE_MANAGER &&
            r.storeId != null &&
            r.storeId === actor.storeId
        )
            return;
        throw new ForbiddenException({ message: this.t("errors.cannotDecide"), code: "APPROVAL_NOT_YOURS" });
    }

    async decide(id: bigint, actor: AuthUser, approve: boolean, dto: DecisionInput) {
        if (!approve && !dto.note?.trim())
            throw new BadRequestException({ message: this.t("errors.noteRequired"), code: "NOTE_REQUIRED" });

        const after: (() => Promise<unknown>)[] = [];
        const updated = await this.prisma.$transaction(
            async (tx) => {
                // Row lock: two reviewers can't decide the same request twice.
                await tx.$queryRaw`SELECT id FROM "ApprovalRequest" WHERE id = ${id} FOR UPDATE`;
                const r = await tx.approvalRequest.findUnique({ where: { id } });
                if (!r) throw new NotFoundException(this.t("errors.notFound"));
                this.assertCanDecide(r, actor);
                if (r.status !== ApprovalRequestStatus.PENDING)
                    throw new ConflictException({ message: this.t("errors.alreadyDecided", { status: r.status }), code: "APPROVAL_ALREADY_DECIDED" });

                const handler = this.handlers[r.type];
                const out: { result?: Record<string, unknown>; afterCommit?: () => Promise<unknown> } | void = handler
                    ? await handler(tx, r, { approve, actor, note: dto.note, options: { restock: dto.restock, refundAmount: dto.refundAmount, applyMedia: dto.applyMedia } })
                    : undefined;
                const done = out || {};
                if (done.afterCommit) after.push(done.afterCommit);

                return tx.approvalRequest.update({
                    where: { id },
                    data: {
                        status: approve ? ApprovalRequestStatus.APPROVED : ApprovalRequestStatus.REJECTED,
                        reviewedById: actor.id,
                        reviewedByRole: actor.role,
                        reviewNote: dto.note ?? null,
                        reviewedAt: new Date(),
                        result: (done.result ?? {}) as Prisma.InputJsonValue,
                    },
                });
            },
            { timeout: 30_000 },
        );

        for (const fn of after) await fn().catch((e) => this.log.warn(`after-commit of approval ${id} failed: ${(e as Error).message}`));
        await this.notifyRequester(updated, approve);
        return (await this.decorate([updated]))[0];
    }

    /** The requester withdraws a pending request (and what it put on hold is released). */
    async cancel(id: bigint, actor: AuthUser) {
        const updated = await this.prisma.$transaction(async (tx) => {
            await tx.$queryRaw`SELECT id FROM "ApprovalRequest" WHERE id = ${id} FOR UPDATE`;
            const r = await tx.approvalRequest.findUnique({ where: { id } });
            const ownStore = actor.role === UserRole.STORE_MANAGER && r?.storeId === actor.storeId && r?.level === ApprovalLevel.ADMIN;
            if (!r || (r.requestedById !== actor.id && !ownStore)) throw new NotFoundException(this.t("errors.notFound"));
            if (r.status !== ApprovalRequestStatus.PENDING)
                throw new ConflictException({ message: this.t("errors.alreadyDecided", { status: r.status }), code: "APPROVAL_ALREADY_DECIDED" });
            if (REVERT_ON_CANCEL.includes(r.type)) await this.handlers[r.type]?.(tx, r, { approve: false, actor });
            return tx.approvalRequest.update({
                where: { id },
                data: { status: ApprovalRequestStatus.CANCELLED, reviewedById: actor.id, reviewedByRole: actor.role, reviewedAt: new Date() },
            });
        });
        return (await this.decorate([updated]))[0];
    }

    private async notifyRequester(r: Request, approved: boolean) {
        // Returns notify the customer themselves (with order context).
        if (r.type === ApprovalType.ORDER_RETURN || r.type === ApprovalType.ORDER_EXCHANGE) return;
        await this.notify.notify(
            r.requestedById,
            "APPROVAL",
            this.t(approved ? "notification.approved" : "notification.rejected", { type: r.type }),
            r.reviewNote ?? r.type,
            { approvalId: r.id.toString(), type: r.type },
        );
    }
}
