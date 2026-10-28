import { MEDIA_ROUTES } from "@modules/media/media.routes";
import { AuthUser } from "@common/types/auth.type";
import { pageParams } from "@common/utils/helpers.util";
import { PrismaService } from "@core/database/prisma.service";
import { LocaleService } from "@core/locale/locale.service";
import {
    ApprovalHandler,
    openApproval,
    pendingFor,
} from "@modules/approvals/approvals.repo";
import {
    NotificationsService,
} from "@modules/notifications/notifications.service";
import { AdminKycListInput, KycDocInput, KycListInput } from "./kyc.types";
import {
    BadRequestException,
    ForbiddenException,
    Injectable,
    NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma-client/client";
import {
    ApprovalRequestStatus,
    ApprovalType,
    KycDocType,
    KycStatus,
    MediaPurpose,
    UserRole,
} from "@prisma-client/enums";
import { I18nService } from "nestjs-i18n";

type Db = Prisma.TransactionClient | PrismaService;

/** Any one of these proves identity (Bangladesh). */
export const ID_DOCS: KycDocType[] = [KycDocType.NID, KycDocType.PASSPORT, KycDocType.DRIVING_LICENSE];

/** KYC is mandatory for these roles. */
export const KYC_ROLES: UserRole[] = [UserRole.STORE_STAFF, UserRole.DELIVERY_PARTNER];

/** OTHER documents a person may keep at once. */
const MAX_OTHER_DOCS = 10;

const mask = (n?: string | null) =>
    n ? `${"X".repeat(Math.max(n.length - 4, 0))}${n.slice(-4)}` : null;

/** Forensic flags of a media row, without exposing the file. */
const flagsOf = (meta: unknown) => {
    const m = (meta ?? {}) as { flags?: Record<string, unknown>; riskScore?: number };
    return { flags: m.flags ?? {}, riskScore: m.riskScore ?? null };
};

const DOC_SELECT = {
    id: true,
    type: true,
    title: true,
    status: true,
    documentNumber: true,
    rejectionReason: true,
    expiresAt: true,
    frontMediaId: true,
    backMediaId: true,
    uploadedById: true,
    submittedAt: true,
    createdAt: true,
    reviewedAt: true,
} satisfies Prisma.KycDocumentSelect;
type DocRow = Prisma.KycDocumentGetPayload<{ select: typeof DOC_SELECT }>;

/** Live = not removed; submitted = locked for review; draft = still editable by the uploader. */
const LIVE = { removedAt: null } as const;
const SUBMITTED = { removedAt: null, submittedAt: { not: null } } as const;

@Injectable()
export class KycService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly notify: NotificationsService,
        private readonly i18n: I18nService,
        private readonly locale: LocaleService,
    ) {}

    private t(key: string, args?: Record<string, unknown>) {
        return this.i18n.translate(`kyc.${key}`, args ? { args } : {}) as string;
    }

    private bad(key: string, code: string, extra: Record<string, unknown> = {}, args?: Record<string, unknown>): never {
        throw new BadRequestException({ message: this.t(`errors.${key}`, args), code, ...extra });
    }

    // ---------------------------------------------------------------------
    // Rules
    // ---------------------------------------------------------------------

    /** What a role must have. Motor vehicles also need DL + RC. OTHER never counts. */
    required(role: UserRole, vehicleType?: string | null) {
        const motor = role === UserRole.DELIVERY_PARTNER && !!vehicleType && vehicleType !== "BICYCLE";
        return {
            all: [KycDocType.SELFIE, ...(motor ? [KycDocType.DRIVING_LICENSE, KycDocType.VEHICLE_RC] : [])],
            oneOf: ID_DOCS,
        };
    }

    /** Missing document types for a set of document types. */
    missing(role: UserRole, vehicleType: string | null | undefined, types: KycDocType[]) {
        const req = this.required(role, vehicleType);
        const missing: string[] = req.all.filter((t) => !types.includes(t));
        if (!req.oneOf.some((t) => types.includes(t))) missing.push(`ONE_OF:${req.oneOf.join("|")}`);
        return missing;
    }

    /**
     * Overall KYC state.
     * - `missing`: what is still needed counting drafts too (= can the uploader submit?)
     * - `missingSubmitted`: what is still needed among submitted, not-rejected documents (= can the admin approve?)
     * - `missingVerified`: what is still needed among VERIFIED documents.
     */
    async state(db: Db, userId: bigint) {
        const user = await db.user.findUniqueOrThrow({
            where: { id: userId },
            select: { role: true, partnerProfile: { select: { vehicleType: true } } },
        });
        const docs = await db.kycDocument.findMany({ where: { userId, ...LIVE }, select: { type: true, status: true, submittedAt: true } });
        const submitted = docs.filter((d) => d.submittedAt);
        const drafts = docs.filter((d) => !d.submittedAt);
        const v = user.partnerProfile?.vehicleType;
        const verified = submitted.filter((d) => d.status === KycStatus.VERIFIED).map((d) => d.type);
        const missingVerified = this.missing(user.role, v, verified);
        const status: KycStatus = !missingVerified.length
            ? KycStatus.VERIFIED
            : submitted.some((d) => d.status === KycStatus.REJECTED) && !submitted.some((d) => d.status === KycStatus.PENDING)
              ? KycStatus.REJECTED
              : KycStatus.PENDING;
        const usable = (rows: typeof docs) => rows.filter((d) => d.status !== KycStatus.REJECTED).map((d) => d.type);
        return {
            status,
            drafts: drafts.length,
            missing: this.missing(user.role, v, [...usable(submitted), ...drafts.map((d) => d.type)]),
            missingSubmitted: this.missing(user.role, v, usable(submitted)),
            missingVerified,
        };
    }

    /** Keeps DeliveryPartnerProfile.kycStatus in sync (the only stored KYC summary). */
    async recompute(db: Db, userId: bigint, reviewerId?: bigint) {
        const profile = await db.deliveryPartnerProfile.findUnique({ where: { userId } });
        if (!profile) return;
        const { status } = await this.state(db, userId);
        await db.deliveryPartnerProfile.update({
            where: { userId },
            data: {
                kycStatus: status,
                ...(status === KycStatus.VERIFIED ? { kycVerifiedAt: new Date(), kycVerifiedById: reviewerId } : {}),
            },
        });
    }

    /**
     * Creates documents (DRAFT unless `submitted`). Files must be KYC media
     * uploaded by `uploaderId` and not used by another document.
     *
     * One live document per type (except OTHER): a new upload REPLACES a
     * draft / pending / rejected one of that type (drafts are deleted,
     * submitted ones are kept as REPLACED for audit). A VERIFIED one is never
     * touched — the new one waits next to it until an admin removes the old one.
     */
    async createDocs(db: Db, userId: bigint, uploaderId: bigint, docs: KycDocInput[], opts: { submitted?: boolean; actor?: AuthUser } = {}) {
        const single = docs.filter((d) => d.type !== KycDocType.OTHER).map((d) => d.type);
        if (new Set(single).size !== single.length) this.bad("duplicateType", "KYC_DUPLICATE_TYPE");
        if (docs.some((d) => d.type === KycDocType.OTHER && !d.title?.trim())) this.bad("titleRequired", "KYC_TITLE_REQUIRED");

        const ids = docs.flatMap((d) => [BigInt(d.frontMediaId), ...(d.backMediaId ? [BigInt(d.backMediaId)] : [])]);
        if (new Set(ids.map(String)).size !== ids.length) throw new BadRequestException(this.t("errors.duplicateMedia"));
        const [files, used, others] = await Promise.all([
            db.mediaFile.findMany({
                where: { id: { in: ids }, uploadedById: uploaderId, purpose: MediaPurpose.KYC, deletedAt: null },
                select: { id: true },
            }),
            db.kycDocument.count({ where: { OR: [{ frontMediaId: { in: ids } }, { backMediaId: { in: ids } }] } }),
            db.kycDocument.count({ where: { userId, type: KycDocType.OTHER, ...LIVE } }),
        ]);
        if (files.length !== ids.length) this.bad("mediaInvalid", "KYC_MEDIA_INVALID");
        if (used) this.bad("mediaInUse", "KYC_MEDIA_IN_USE");
        const newOthers = docs.filter((d) => d.type === KycDocType.OTHER).length;
        if (others + newOthers > MAX_OTHER_DOCS) this.bad("tooManyOther", "KYC_TOO_MANY_OTHER", { max: MAX_OTHER_DOCS }, { max: MAX_OTHER_DOCS });

        // Replace unapproved documents of the same types.
        const replaceable = single.length
            ? await db.kycDocument.findMany({
                  where: { userId, type: { in: single }, ...LIVE, status: { not: KycStatus.VERIFIED } },
                  select: { id: true, submittedAt: true, frontMediaId: true, backMediaId: true },
              })
            : [];
        const replaced = await this.discard(db, replaceable, "REPLACED", opts.actor);

        const now = new Date();
        const created: bigint[] = [];
        for (const d of docs) {
            const row = await db.kycDocument.create({
                data: {
                    userId,
                    type: d.type,
                    title: d.type === KycDocType.OTHER ? d.title!.trim() : (d.title?.trim() ?? null),
                    documentNumber: mask(d.documentNumber),
                    frontMediaId: BigInt(d.frontMediaId),
                    backMediaId: d.backMediaId ? BigInt(d.backMediaId) : null,
                    expiresAt: d.expiresAt ? new Date(d.expiresAt) : null,
                    uploadedById: uploaderId,
                    submittedAt: opts.submitted ? now : null,
                },
                select: { id: true },
            });
            created.push(row.id);
        }
        return { created, replaced };
    }

    /**
     * Takes unapproved documents out: drafts are deleted with their files;
     * submitted ones are kept (removedAt + reason) and any open request on
     * them (forward to admin, removal) is cancelled.
     */
    private async discard(
        db: Db,
        rows: { id: bigint; submittedAt: Date | null; frontMediaId: bigint; backMediaId: bigint | null }[],
        reason: "REPLACED" | "DELETED",
        actor?: AuthUser,
    ) {
        if (!rows.length) return [];
        const drafts = rows.filter((r) => !r.submittedAt);
        const submitted = rows.filter((r) => r.submittedAt);
        if (drafts.length) {
            await db.kycDocument.deleteMany({ where: { id: { in: drafts.map((d) => d.id) } } });
            await db.mediaFile.updateMany({
                where: { id: { in: drafts.flatMap((d) => [d.frontMediaId, ...(d.backMediaId ? [d.backMediaId] : [])]) } },
                data: { deletedAt: new Date() },
            });
        }
        if (submitted.length) {
            const ids = submitted.map((d) => d.id);
            await db.kycDocument.updateMany({ where: { id: { in: ids } }, data: { removedAt: new Date(), removedReason: reason } });
            await db.approvalRequest.updateMany({
                where: {
                    targetType: "KycDocument",
                    targetId: { in: ids },
                    status: ApprovalRequestStatus.PENDING,
                    type: { in: [ApprovalType.KYC_VERIFICATION, ApprovalType.KYC_DOC_REMOVAL] },
                },
                data: {
                    status: ApprovalRequestStatus.CANCELLED,
                    reviewNote: "Document replaced",
                    reviewedAt: new Date(),
                    ...(actor && { reviewedById: actor.id, reviewedByRole: actor.role }),
                },
            });
        }
        return rows.map((r) => r.id);
    }

    // ---------------------------------------------------------------------
    // Editing (member self-service, or the store manager while onboarding)
    // ---------------------------------------------------------------------

    /**
     * The documents of `userId` as their editor sees them: drafts are
     * previewable / deletable, unapproved ones replaceable, approved ones
     * removable only through an admin request.
     */
    async view(userId: bigint) {
        const [user, docs, state, removals] = await Promise.all([
            this.prisma.user.findUniqueOrThrow({
                where: { id: userId },
                select: { role: true, approvalStatus: true, partnerProfile: { select: { vehicleType: true } } },
            }),
            this.prisma.kycDocument.findMany({ where: { userId, ...LIVE }, orderBy: [{ type: "asc" }, { id: "desc" }], select: DOC_SELECT }),
            this.state(this.prisma, userId),
            this.prisma.approvalRequest.findMany({
                where: { type: ApprovalType.KYC_DOC_REMOVAL, targetType: "KycDocument", snapshot: { path: ["userId"], equals: userId.toString() } },
                orderBy: { id: "desc" },
                take: 20,
                select: { id: true, targetId: true, status: true, note: true, reviewNote: true, createdAt: true },
            }),
        ]);
        return {
            kycStatus: state.status,
            required: this.required(user.role, user.partnerProfile?.vehicleType),
            /** Still needed before you can submit (drafts count). */
            missing: state.missing,
            drafts: state.drafts,
            canSubmit: state.drafts > 0 && state.missing.length === 0,
            documents: docs.map((d) => this.presentOwn(d)),
            removalRequests: removals,
        };
    }

    private presentOwn(d: DocRow) {
        const draft = !d.submittedAt;
        return {
            id: d.id,
            type: d.type,
            title: d.title,
            state: draft ? "DRAFT" : d.status,
            status: d.status,
            documentNumber: d.documentNumber,
            rejectionReason: d.rejectionReason,
            expiresAt: d.expiresAt,
            createdAt: d.createdAt,
            submittedAt: d.submittedAt,
            reviewedAt: d.reviewedAt,
            /** Preview (GET with your token). */
            frontFile: MEDIA_ROUTES.file(d.frontMediaId),
            backFile: d.backMediaId ? MEDIA_ROUTES.file(d.backMediaId) : null,
            canDelete: draft,
            /** Uploading the same type again replaces it (not for OTHER: add another one). */
            replaceable: d.status !== KycStatus.VERIFIED && d.type !== KycDocType.OTHER,
            /** Approved: only an admin can remove it (POST …/removal-request). */
            removalNeedsAdmin: !draft,
        };
    }

    /** Add (or replace) one document as a DRAFT. */
    async addDoc(userId: bigint, uploader: AuthUser, dto: KycDocInput) {
        const out = await this.prisma.$transaction(async (tx) => {
            const res = await this.createDocs(tx, userId, uploader.id, [dto], { actor: uploader });
            await this.recompute(tx, userId);
            return res;
        });
        return { ...(await this.view(userId)), added: out.created[0], replaced: out.replaced };
    }

    /** Delete a DRAFT (submitted documents are locked: replace them, or ask an admin). */
    async deleteDraft(userId: bigint, docId: bigint) {
        const doc = await this.prisma.kycDocument.findFirst({
            where: { id: docId, userId, ...LIVE },
            select: { id: true, submittedAt: true, frontMediaId: true, backMediaId: true },
        });
        if (!doc) throw new NotFoundException(this.t("errors.notFound"));
        if (doc.submittedAt) this.bad("notDraft", "KYC_NOT_DRAFT");
        await this.prisma.$transaction(async (tx) => {
            await this.discard(tx, [doc], "DELETED");
            await this.recompute(tx, userId);
        });
        return this.view(userId);
    }

    /** Lock every draft for review. Needs the full required set (drafts + submitted). */
    private async submitDrafts(tx: Db, userId: bigint) {
        const state = await this.state(tx, userId);
        if (!state.drafts) this.bad("nothingToSubmit", "KYC_NOTHING_TO_SUBMIT");
        if (state.missing.length)
            this.bad("docsMissing", "KYC_DOCS_MISSING", { missing: state.missing }, { missing: state.missing.join(", ") });
        const { count } = await tx.kycDocument.updateMany({ where: { userId, ...LIVE, submittedAt: null }, data: { submittedAt: new Date() } });
        await this.recompute(tx, userId);
        return count;
    }

    // ── Member (staff / delivery partner) ──────────────────────────────────

    mine(user: AuthUser) {
        return this.view(user.id);
    }

    add(user: AuthUser, dto: KycDocInput) {
        if (!KYC_ROLES.includes(user.role)) throw new ForbiddenException();
        return this.addDoc(user.id, user, dto);
    }

    removeDraft(user: AuthUser, docId: bigint) {
        return this.deleteDraft(user.id, docId);
    }

    /** Member submits their drafts; the store's managers are told to review. */
    async submit(user: AuthUser) {
        const count = await this.prisma.$transaction((tx) => this.submitDrafts(tx, user.id));
        if (user.storeId) {
            const managers = await this.prisma.user.findMany({
                where: { storeId: user.storeId, role: UserRole.STORE_MANAGER, deletedAt: null },
                select: { id: true },
            });
            await Promise.all(
                managers.map((m) => this.notify.notify(m.id, "KYC", this.t("notification.submitted"), String(count), { userId: user.id.toString() })),
            );
        }
        return { ...(await this.view(user.id)), submitted: count };
    }

    async requestRemoval(user: AuthUser, docId: bigint, note: string) {
        const doc = await this.prisma.kycDocument.findFirst({ where: { id: docId, userId: user.id, ...LIVE } });
        if (!doc) throw new NotFoundException(this.t("errors.notFound"));
        if (!doc.submittedAt) this.bad("draftDeleteDirectly", "KYC_IS_DRAFT");
        const request = await this.prisma.$transaction((tx) =>
            openApproval(tx, user, {
                type: ApprovalType.KYC_DOC_REMOVAL,
                storeId: user.storeId,
                targetType: "KycDocument",
                targetId: doc.id,
                note,
                snapshot: { userId: doc.userId, type: doc.type, title: doc.title, status: doc.status, documentNumber: doc.documentNumber },
            }),
        );
        return { success: true, approvalId: request.id, status: request.status };
    }

    // ── Store manager while onboarding a member ────────────────────────────

    /**
     * The manager edits a member's KYC only while onboarding: the member is
     * PENDING in their store and the onboarding request hasn't been sent.
     * After sending, the files are locked away from the store.
     */
    private async assertOnboardingDraft(storeId: bigint, userId: bigint) {
        const user = await this.prisma.user.findFirst({
            where: { id: userId, storeId, role: { in: KYC_ROLES }, deletedAt: null },
            select: { id: true, approvalStatus: true },
        });
        if (!user) throw new NotFoundException(this.t("errors.memberNotFound"));
        const sent = await pendingFor(this.prisma, ApprovalType.MEMBER_ONBOARDING, "User", userId);
        if (user.approvalStatus !== "PENDING" || sent)
            throw new ForbiddenException({ message: this.t("errors.onboardingLocked"), code: "KYC_ONBOARDING_LOCKED" });
    }

    async memberView(storeId: bigint, userId: bigint) {
        await this.assertOnboardingDraft(storeId, userId);
        return this.view(userId);
    }

    async memberAdd(storeId: bigint, userId: bigint, actor: AuthUser, dto: KycDocInput) {
        await this.assertOnboardingDraft(storeId, userId);
        return this.addDoc(userId, actor, dto);
    }

    async memberDelete(storeId: bigint, userId: bigint, docId: bigint) {
        await this.assertOnboardingDraft(storeId, userId);
        return this.deleteDraft(userId, docId);
    }

    /** Manager submits the member's KYC and sends the sign-up to the admin (MEMBER_ONBOARDING). */
    async memberSubmit(storeId: bigint, userId: bigint, actor: AuthUser, note?: string) {
        await this.assertOnboardingDraft(storeId, userId);
        const request = await this.prisma.$transaction(async (tx) => {
            await this.submitDrafts(tx, userId);
            const user = await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { role: true, name: true, phone: true, staffDuties: true } });
            const types = await tx.kycDocument.findMany({ where: { userId, ...SUBMITTED }, select: { type: true } });
            return openApproval(tx, actor, {
                type: ApprovalType.MEMBER_ONBOARDING,
                storeId,
                targetType: "User",
                targetId: userId,
                note,
                payload: { role: user.role, duties: user.staffDuties, kycTypes: types.map((t) => t.type) },
                snapshot: { name: user.name, phone: user.phone },
            });
        });
        return { success: true, approvalId: request.id, status: request.status };
    }

    // ---------------------------------------------------------------------
    // Store manager: review & forward (never sees the files)
    // ---------------------------------------------------------------------

    async storeList(storeId: bigint, q: KycListInput) {
        const { take, skip, page, limit } = pageParams(q);
        const where: Prisma.KycDocumentWhereInput = {
            ...SUBMITTED, // drafts are still being prepared
            ...(q.status && { status: q.status }),
            ...(q.userId && { userId: BigInt(q.userId) }),
            user: { storeId, role: q.role ?? { in: KYC_ROLES }, deletedAt: null },
        };
        const [rows, total] = await Promise.all([
            this.prisma.kycDocument.findMany({
                where,
                orderBy: { createdAt: "asc" },
                take,
                skip,
                include: { user: { select: { id: true, name: true, phone: true, role: true, approvalStatus: true } } },
            }),
            this.prisma.kycDocument.count({ where }),
        ]);
        const meta = await this.mediaMeta(rows);
        const forwarded = await this.prisma.approvalRequest.findMany({
            where: {
                type: ApprovalType.KYC_VERIFICATION,
                targetType: "KycDocument",
                targetId: { in: rows.map((r) => r.id) },
            },
            orderBy: { id: "desc" },
            select: { targetId: true, status: true, payload: true, createdAt: true },
        });
        return {
            items: rows.map((r) => ({
                id: r.id,
                type: r.type,
                title: r.title,
                status: r.status,
                documentNumber: r.documentNumber,
                expiresAt: r.expiresAt,
                rejectionReason: r.rejectionReason,
                createdAt: r.createdAt,
                uploadedBy: r.uploadedById === r.userId ? "SELF" : "STORE",
                user: r.user,
                // Files stay hidden from the store; forensic flags help the review.
                forensics: {
                    front: flagsOf(meta.get(r.frontMediaId.toString())),
                    back: r.backMediaId ? flagsOf(meta.get(r.backMediaId.toString())) : null,
                },
                forwarded: forwarded.find((f) => f.targetId === r.id) ?? null,
            })),
            total,
            page,
            limit,
        };
    }

    private async mediaMeta(rows: { frontMediaId: bigint; backMediaId: bigint | null }[]) {
        const ids = rows.flatMap((r) => [r.frontMediaId, ...(r.backMediaId ? [r.backMediaId] : [])]);
        const media = await this.prisma.mediaFile.findMany({
            where: { id: { in: ids } },
            select: { id: true, metadata: true, mimeType: true, sizeBytes: true, checksum: true, createdAt: true },
        });
        return new Map(media.map((m) => [m.id.toString(), m.metadata]));
    }

    /** Store manager reviewed the document: send it to the admin with a recommendation. */
    async forward(actor: AuthUser, storeId: bigint, docId: bigint, recommendation: string, note?: string) {
        const doc = await this.prisma.kycDocument.findFirst({
            where: { id: docId, ...SUBMITTED, user: { storeId, role: { in: KYC_ROLES } } },
        });
        if (!doc) throw new NotFoundException(this.t("errors.notFound"));
        if (doc.status !== KycStatus.PENDING)
            throw new BadRequestException({ message: this.t("errors.notPending"), code: "KYC_NOT_PENDING" });
        const request = await this.prisma.$transaction((tx) =>
            openApproval(tx, actor, {
                type: ApprovalType.KYC_VERIFICATION,
                storeId,
                targetType: "KycDocument",
                targetId: doc.id,
                note,
                payload: { recommendation, userId: doc.userId },
                snapshot: { type: doc.type, documentNumber: doc.documentNumber },
            }),
        );
        return { success: true, approvalId: request.id };
    }

    // ---------------------------------------------------------------------
    // Admin
    // ---------------------------------------------------------------------

    async adminList(q: AdminKycListInput) {
        const { take, skip, page, limit } = pageParams(q);
        const where: Prisma.KycDocumentWhereInput = {
            ...SUBMITTED, // drafts are still being prepared
            ...(q.status && { status: q.status }),
            ...(q.userId && { userId: BigInt(q.userId) }),
            user: {
                role: q.role ?? { in: KYC_ROLES },
                ...(q.storeId && { storeId: BigInt(q.storeId) }),
            },
        };
        const [rows, total] = await Promise.all([
            this.prisma.kycDocument.findMany({
                where,
                orderBy: { createdAt: "asc" },
                take,
                skip,
                include: { user: { select: { id: true, name: true, phone: true, role: true, storeId: true } } },
            }),
            this.prisma.kycDocument.count({ where }),
        ]);
        const meta = await this.mediaMeta(rows);
        return {
            items: rows.map((r) => ({
                ...r,
                // Admins open the files through GET /account/media/{id}/file.
                frontFile: MEDIA_ROUTES.file(r.frontMediaId),
                backFile: r.backMediaId ? MEDIA_ROUTES.file(r.backMediaId) : null,
                forensics: {
                    front: meta.get(r.frontMediaId.toString()) ?? null,
                    back: r.backMediaId ? (meta.get(r.backMediaId.toString()) ?? null) : null,
                },
            })),
            total,
            page,
            limit,
        };
    }

    /** Admin decision on one document. Closes a pending forward request for it. */
    async review(actor: AuthUser, docId: bigint, approve: boolean, reason?: string) {
        if (!approve && !reason) throw new BadRequestException(this.t("errors.reasonRequired"));
        const doc = await this.prisma.$transaction(async (tx) => {
            const updated = await this.decide(tx, actor, docId, approve, reason);
            const pending = await pendingFor(tx, ApprovalType.KYC_VERIFICATION, "KycDocument", docId);
            if (pending)
                await tx.approvalRequest.update({
                    where: { id: pending.id },
                    data: {
                        status: approve ? ApprovalRequestStatus.APPROVED : ApprovalRequestStatus.REJECTED,
                        reviewedById: actor.id,
                        reviewedByRole: actor.role,
                        reviewNote: reason ?? null,
                        reviewedAt: new Date(),
                    },
                });
            return updated;
        });
        await this.notifyDecision(doc.userId, doc.type, approve, reason);
        return { success: true };
    }

    private async decide(tx: Db, actor: AuthUser, docId: bigint, approve: boolean, reason?: string) {
        const doc = await tx.kycDocument.findFirst({ where: { id: docId, ...SUBMITTED } });
        if (!doc) throw new NotFoundException(this.t("errors.notFound"));
        const updated = await tx.kycDocument.update({
            where: { id: docId },
            data: {
                status: approve ? KycStatus.VERIFIED : KycStatus.REJECTED,
                reviewedById: actor.id,
                reviewedAt: new Date(),
                rejectionReason: approve ? null : (reason ?? null),
            },
        });
        await this.recompute(tx, doc.userId, actor.id);
        return updated;
    }

    /** Admin approves member onboarding: every pending document is verified with it. */
    async verifyAllPending(tx: Db, userId: bigint, actor: AuthUser, approve: boolean, reason?: string) {
        await tx.kycDocument.updateMany({
            where: { userId, ...SUBMITTED, status: KycStatus.PENDING },
            data: {
                status: approve ? KycStatus.VERIFIED : KycStatus.REJECTED,
                reviewedById: actor.id,
                reviewedAt: new Date(),
                rejectionReason: approve ? null : (reason ?? null),
            },
        });
        await this.recompute(tx, userId, actor.id);
    }

    private async notifyDecision(userId: bigint, type: string, approve: boolean, reason?: string) {
        const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { language: true } });
        await this.notify.notify(
            userId,
            "KYC",
            this.i18n.translate(approve ? "kyc.notification.verified" : "kyc.notification.rejected", {
                lang: this.locale.resolve(user?.language),
            }) as string,
            approve ? type : (reason ?? type),
            { type },
        );
    }

    /** Approval handlers owned by KYC. */
    handlers(): Partial<Record<ApprovalType, ApprovalHandler>> {
        return {
            [ApprovalType.KYC_VERIFICATION]: async (tx, req, { approve, actor, note }) => {
                const doc = await this.decide(tx, actor, req.targetId, approve, approve ? undefined : (note ?? "Rejected"));
                return {
                    result: { documentStatus: doc.status },
                    afterCommit: () => this.notifyDecision(doc.userId, doc.type, approve, note),
                };
            },
            [ApprovalType.KYC_DOC_REMOVAL]: async (tx, req, { approve }) => {
                if (!approve) return { result: { removed: false } };
                const doc = await tx.kycDocument.update({
                    where: { id: req.targetId },
                    data: { removedAt: new Date(), removedReason: "ADMIN_REMOVAL" },
                });
                await this.recompute(tx, doc.userId);
                return { result: { removed: true } };
            },
        };
    }
}
