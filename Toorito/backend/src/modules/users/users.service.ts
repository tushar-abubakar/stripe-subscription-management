import { AccountHold, canManageUser } from "@common/authorization/permissions";
import { AuthUser } from "@common/types/auth.type";
import { holdKey } from "@core/auth/auth.guard";
import {
    ApprovalHandler,
    openApproval,
    pendingFor,
} from "@modules/approvals/approvals.repo";
import { KycService } from "@modules/kyc/kyc.service";
import { normalizeE164Phone, pageParams } from "@common/utils/helpers.util";
import { AppConfig } from "@config/config.type";
import { AddressService } from "@core/address/address.service";
import { AuditService } from "@core/audit/audit.service";
import { CurrencyService } from "@core/currency/currency.service";
import { PrismaService } from "@core/database/prisma.service";
import { LocaleService } from "@core/locale/locale.service";
import { RedisService } from "@core/redis/redis.service";
import { OtpCtx, OtpService } from "@modules/auth/otp.service";
import { TokenService } from "@core/auth/token.service";
import { MediaService, type UploadedFile } from "@modules/media/media.service";
import { PaymentsService } from "@modules/payments/payments.service";
import {
    AccessRoleInput,
    AddressInput,
    AdminCreateUserInput,
    AdminUpdateUserInput,
    ActivityInput,
    AdminUserListInput,
    CreateTeamMemberInput,
    HoldInput,
    PASSWORD_ROLES,
    PhoneChangeVerifyInput,
    PRIVILEGED_ROLES,
    ProfileInput,
    STORE_ROLES,
    THEMES,
    UpdateStaffInput,
    WalletAdjustInput,
    WalletInput,
    WishlistInput,
} from "./users.types";
import {
    BadRequestException,
    ConflictException,
    ForbiddenException,
    Injectable,
    NotFoundException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Prisma } from "@prisma-client/client";
import {
    ApprovalRequestStatus,
    ApprovalStatus,
    ApprovalType,
    ProductStatus,
    StaffDuty,
    UserRole,
    UserStatus,
    WalletTxnType,
} from "@prisma-client/enums";
import * as argon2 from "argon2";
import { I18nService } from "nestjs-i18n";

/** Saved addresses one customer may keep. */
const MAX_ADDRESSES_PER_USER = 20;

/** Products one customer may keep in the wishlist. */
const MAX_WISHLIST_ITEMS = 500;

const phoneChangeKey = (userId: bigint) => `phone-change:${userId}`;

/** "+8801712345678" → "+880*******678" */
const maskPhone = (phone: string) => (phone.length > 7 ? `${phone.slice(0, 4)}${"*".repeat(phone.length - 7)}${phone.slice(-3)}` : phone);

const isAdminRole = (role: UserRole) => role === UserRole.ADMIN || role === UserRole.SUPER_ADMIN;

export interface UserSettings {
    theme: (typeof THEMES)[number];
    notifications: {
        orderUpdates: boolean;
        promotions: boolean;
        push: boolean;
        sms: boolean;
        email: boolean;
    };
}

const DEFAULT_SETTINGS: UserSettings = {
    theme: "SYSTEM",
    notifications: { orderUpdates: true, promotions: false, push: true, sms: true, email: false },
};

/** Saved settings on top of the defaults (unknown keys dropped). */
const settingsOf = (value: unknown): UserSettings => {
    const saved = (value && typeof value === "object" ? value : {}) as Partial<UserSettings>;
    const theme = THEMES.includes(saved.theme as UserSettings["theme"]) ? saved.theme! : DEFAULT_SETTINGS.theme;
    const notifications = { ...DEFAULT_SETTINGS.notifications };

    for (const key of Object.keys(notifications) as (keyof UserSettings["notifications"])[]) {
        const flag = saved.notifications?.[key];
        if (typeof flag === "boolean") notifications[key] = flag;
    }

    return { theme, notifications };
};

const AVATAR_SELECT = { select: { id: true, key: true, isPrivate: true, variants: true, status: true } } as const;

/** Columns shown in admin lists. */
const USER_LIST_SELECT = {
    id: true,
    phone: true,
    name: true,
    email: true,
    role: true,
    status: true,
    approvalStatus: true,
    storeId: true,
    walletBalance: true,
    lastLoginAt: true,
    createdAt: true,
    avatar: AVATAR_SELECT,
    store: { select: { id: true, code: true, name: true } },
    accessRole: { select: { id: true, code: true, name: true } },
} satisfies Prisma.UserSelect;

/** Admin detail = list columns + everything an edit form / audit view needs. */
const USER_DETAIL_SELECT = {
    ...USER_LIST_SELECT,
    language: true,
    settings: true,
    statusReason: true,
    rejectionReason: true,
    approvedById: true,
    approvedAt: true,
    phoneVerifiedAt: true,
    updatedAt: true,
    partnerProfile: { select: { kycStatus: true, vehicleType: true, isOnline: true, activeOrderCount: true } },
    _count: { select: { orders: true, addresses: true, wishlist: true, sessions: { where: { revokedAt: null } } } },
} satisfies Prisma.UserSelect;

type ListedUser = Prisma.UserGetPayload<{ select: typeof USER_LIST_SELECT }>;

@Injectable()
export class UsersService {
    private readonly otpTtlSec: number;

    constructor(
        private readonly prisma: PrismaService,
        private readonly redis: RedisService,
        private readonly audit: AuditService,
        private readonly otp: OtpService,
        private readonly tokens: TokenService,
        private readonly media: MediaService,
        private readonly payments: PaymentsService,
        private readonly address: AddressService,
        private readonly locale: LocaleService,
        private readonly currency: CurrencyService,
        private readonly i18n: I18nService,
        private readonly kyc: KycService,
        config: ConfigService,
    ) {
        this.otpTtlSec = config.getOrThrow<AppConfig["otp"]>("otp").ttlSec;
    }

    // ─── Errors / presenters ─────────────────────────────────────────────────

    private t(key: string, args?: Record<string, unknown>) {
        return this.i18n.translate(`users.errors.${key}`, { args });
    }

    private code(key: string) {
        return key.replace(/[A-Z]/g, (c) => `_${c}`).toUpperCase();
    }

    private bad(key: string, args?: Record<string, unknown>): never {
        throw new BadRequestException({ message: this.t(key, args), code: this.code(key) });
    }

    private conflict(key: string, args?: Record<string, unknown>): never {
        throw new ConflictException({ message: this.t(key, args), code: this.code(key) });
    }

    private forbidden(key = "forbidden"): never {
        throw new ForbiddenException({ message: this.t(key), code: this.code(key) });
    }

    private notFound(key = "userNotFound"): never {
        throw new NotFoundException({ message: this.t(key), code: this.code(key) });
    }

    /** URLs are null while the image is still PROCESSING (or if processing FAILED). */
    private avatarView(avatar: { id: bigint; key: string; isPrivate: boolean; variants: unknown; status: string } | null) {
        if (!avatar) return null;

        const ready = avatar.status === "READY";

        return {
            id: avatar.id,
            status: avatar.status,
            thumbUrl: ready ? this.media.urlForVariant(avatar, "thumb") : null,
            url: ready ? this.media.urlForVariant(avatar, "master") : null,
        };
    }

    private presentUser<T extends ListedUser>(user: T) {
        const { avatar, walletBalance, ...rest } = user;

        return {
            ...rest,
            avatar: this.avatarView(avatar),
            walletBalance: this.currency.format(walletBalance),
        };
    }

    // ─── Admin: users CRUD ───────────────────────────────────────────────────

    /**
     * Who may manage whom:
     * - SUPER_ADMIN accounts are managed by nobody through the API (except themselves via /account).
     * - ADMIN accounts only by a SUPER_ADMIN.
     * - Everyone else by any admin with the right permission.
     */
    private assertCanManage(actor: AuthUser, target: { id: bigint; role: UserRole }) {
        if (target.id === actor.id) this.forbidden("cannotManageSelf");
        if (target.role === UserRole.SUPER_ADMIN) this.forbidden();
        if (target.role === UserRole.ADMIN && actor.role !== UserRole.SUPER_ADMIN) this.forbidden();
    }

    private async loadUser(id: bigint) {
        const user = await this.prisma.user.findFirst({
            where: { id, deletedAt: null },
            select: { id: true, role: true, phone: true, storeId: true, walletBalance: true, accessRoleId: true },
        });

        if (!user) this.notFound();

        return user;
    }

    private async assertStore(storeId: number | bigint) {
        const store = await this.prisma.store.findUnique({ where: { id: BigInt(storeId) }, select: { id: true } });
        if (!store) this.notFound("storeNotFound");
        return store.id;
    }

    private async assertAccessRole(accessRoleId: number | bigint) {
        const role = await this.prisma.accessRole.findUnique({
            where: { id: BigInt(accessRoleId) },
            select: { id: true, isActive: true },
        });
        if (!role) this.notFound("accessRoleNotFound");
        if (!role.isActive) this.bad("accessRoleInactive");
        return role.id;
    }

    private async assertPhoneFree(phone: string, role: UserRole, exceptId?: bigint) {
        const taken = await this.prisma.user.findFirst({
            where: { phone, role, deletedAt: null, ...(exceptId ? { id: { not: exceptId } } : {}) },
            select: { id: true },
        });
        if (taken) this.conflict("phoneTaken", { phone, role });
    }

    async list(q: AdminUserListInput & { skip: number; take: number; page: number; limit: number }) {
        const term = q.q?.trim();
        const where: Prisma.UserWhereInput = {
            deletedAt: null,
            ...(q.role ? { role: q.role } : {}),
            ...(q.status ? { status: q.status } : {}),
            ...(q.approvalStatus ? { approvalStatus: q.approvalStatus } : {}),
            ...(q.storeId ? { storeId: BigInt(q.storeId) } : {}),
            ...(term
                ? {
                      OR: [
                          { name: { contains: term, mode: "insensitive" } },
                          { email: { contains: term, mode: "insensitive" } },
                          { phone: { contains: term.replace(/[^\d+]/g, "") || term } },
                      ],
                  }
                : {}),
        };

        const orderBy: Prisma.UserOrderByWithRelationInput =
            q.sort === "oldest"
                ? { id: "asc" }
                : q.sort === "name_asc"
                  ? { name: "asc" }
                  : q.sort === "name_desc"
                    ? { name: "desc" }
                    : q.sort === "last_login"
                      ? { lastLoginAt: { sort: "desc", nulls: "last" } }
                      : { id: "desc" };

        const [items, total] = await Promise.all([
            this.prisma.user.findMany({ where, orderBy, skip: q.skip, take: q.take, select: USER_LIST_SELECT }),
            this.prisma.user.count({ where }),
        ]);

        return { items: items.map((user) => this.presentUser(user)), total, page: q.page, limit: q.limit };
    }

    async get(id: bigint) {
        const user = await this.prisma.user.findFirst({ where: { id, deletedAt: null }, select: USER_DETAIL_SELECT });

        if (!user) this.notFound();

        return { ...this.presentUser(user), settings: settingsOf(user.settings) };
    }

    async create(dto: AdminCreateUserInput, actor: AuthUser) {
        if (PRIVILEGED_ROLES.includes(dto.role) && actor.role !== UserRole.SUPER_ADMIN) this.forbidden();

        const phone = normalizeE164Phone(dto.phone)!;
        await this.assertPhoneFree(phone, dto.role);

        if (dto.storeId !== undefined && !STORE_ROLES.includes(dto.role)) this.bad("storeNotAllowed", { role: dto.role });
        if (dto.accessRoleId !== undefined && dto.role !== UserRole.ADMIN) this.bad("accessRoleNotAllowed");

        const storeId = dto.storeId !== undefined ? await this.assertStore(dto.storeId) : null;
        const accessRoleId = dto.accessRoleId !== undefined ? await this.assertAccessRole(dto.accessRoleId) : null;

        // Delivery partners still need verified KYC before they can work.
        const approved = dto.role !== UserRole.DELIVERY_PARTNER;

        let id: bigint;

        try {
            ({ id } = await this.prisma.user.create({
                data: {
                    role: dto.role,
                    phone,
                    name: dto.name,
                    email: dto.email ?? null,
                    language: dto.language ?? this.locale.defaultLanguage,
                    storeId,
                    accessRoleId,
                    passwordHash: PASSWORD_ROLES.includes(dto.role) ? await argon2.hash(dto.password!) : null,
                    approvalStatus: approved ? ApprovalStatus.APPROVED : ApprovalStatus.PENDING,
                    approvedById: approved ? actor.id : null,
                    approvedAt: approved ? new Date() : null,
                },
                select: { id: true },
            }));
        } catch (error) {
            if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
                this.conflict("phoneTaken", { phone, role: dto.role });
            }
            throw error;
        }

        this.audit.log({
            actorId: actor.id,
            actorRole: actor.role,
            storeId,
            action: "user.create",
            entityType: "User",
            entityId: id,
            after: { role: dto.role, storeId: storeId?.toString() ?? null },
        });

        return this.get(id);
    }

    async update(id: bigint, dto: AdminUpdateUserInput, actor: AuthUser) {
        const target = await this.loadUser(id);
        this.assertCanManage(actor, target);

        const data: Prisma.UserUncheckedUpdateInput = {};
        let signOut = false;

        if (dto.name !== undefined) data.name = dto.name;
        if (dto.email !== undefined) data.email = dto.email;
        if (dto.language !== undefined) data.language = dto.language;

        if (dto.phone !== undefined) {
            const phone = normalizeE164Phone(dto.phone)!;

            if (phone !== target.phone) {
                await this.assertPhoneFree(phone, target.role, id);
                data.phone = phone;
                data.phoneVerifiedAt = null;
            }
        }

        if (dto.password !== undefined) {
            if (!PASSWORD_ROLES.includes(target.role)) this.bad("passwordNotAllowed", { role: target.role });
            data.passwordHash = await argon2.hash(dto.password);
            data.failedPasswordCount = 0;
            data.passwordLockedUntil = null;
            signOut = true;
        }

        if (dto.storeId !== undefined) {
            if (!STORE_ROLES.includes(target.role)) this.bad("storeNotAllowed", { role: target.role });
            // null = remove from the store. A manager / staff member without a store keeps the
            // account but cannot use store endpoints until reassigned.
            const storeId = dto.storeId === null ? null : await this.assertStore(dto.storeId);

            if (storeId !== target.storeId) {
                data.storeId = storeId;
                signOut = true; // tokens carry the store id
            }
        }

        if (dto.accessRoleId !== undefined) {
            if (target.role !== UserRole.ADMIN) this.bad("accessRoleNotAllowed");
            data.accessRoleId = await this.assertAccessRole(dto.accessRoleId);
        }

        try {
            await this.prisma.user.update({ where: { id }, data });
        } catch (error) {
            if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
                this.conflict("phoneTaken", { phone: dto.phone, role: target.role });
            }
            throw error;
        }

        if (dto.accessRoleId !== undefined) await this.redis.del(`perm:${id}`);
        if (signOut) await this.tokens.revokeAllForUser(id);

        this.audit.log({
            actorId: actor.id,
            actorRole: actor.role,
            storeId: target.storeId,
            action: "user.update",
            entityType: "User",
            entityId: id,
            after: { ...dto, password: dto.password ? "***" : undefined },
        });

        return this.get(id);
    }

    /**
     * Soft delete: the account can no longer sign in and its phone is freed
     * (`deleted:<id>`), while orders and wallet history keep their owner.
     */
    async remove(id: bigint, actor: AuthUser) {
        const target = await this.loadUser(id);
        this.assertCanManage(actor, target);

        if (Number(target.walletBalance) > 0) {
            this.conflict("walletNotEmpty", { balance: this.currency.format(target.walletBalance).formatted });
        }

        await this.prisma.$transaction([
            this.prisma.user.update({
                where: { id },
                data: { phone: `deleted:${id}`, email: null, passwordHash: null, deletedAt: new Date() },
            }),
            this.prisma.wishlistItem.deleteMany({ where: { userId: id } }),
        ]);

        await this.tokens.revokeAllForUser(id);
        await this.redis.del(`perm:${id}`);

        this.audit.log({
            actorId: actor.id,
            actorRole: actor.role,
            storeId: target.storeId,
            action: "user.delete",
            entityType: "User",
            entityId: id,
            before: { phone: target.phone, role: target.role },
        });

        return { success: true, id };
    }

    // ─── Approvals ───────────────────────────────────────────────────────────

    /**
     * Admin approves STORE_MANAGER. Admins, or the store's manager, approve
     * STORE_STAFF / DELIVERY_PARTNER. Delivery partners need VERIFIED KYC.
     */
    private async loadApprovable(targetId: bigint, actor: AuthUser) {
        const target = await this.prisma.user.findFirst({
            where: { id: targetId, deletedAt: null },
            include: { partnerProfile: true },
        });

        if (!target) this.notFound();

        const isAdmin = isAdminRole(actor.role);

        if (target.role === UserRole.STORE_MANAGER) {
            if (!isAdmin) this.forbidden();
        } else if (target.role === UserRole.STORE_STAFF || target.role === UserRole.DELIVERY_PARTNER) {
            const sameStore = actor.role === UserRole.STORE_MANAGER && !!actor.storeId && target.storeId === actor.storeId;
            if (!isAdmin && !sameStore) this.forbidden("notYourStore");
        } else {
            this.bad("userTypeDoesNotNeedApproval");
        }

        return target;
    }

    async approve(targetId: bigint, actor: AuthUser) {
        const target = await this.loadApprovable(targetId, actor);

        // Store managers can't finalise: the sign-up goes to the admin as MEMBER_ONBOARDING.
        if (actor.role === UserRole.STORE_MANAGER) {
            const pending = await pendingFor(this.prisma, ApprovalType.MEMBER_ONBOARDING, "User", target.id);
            if (!pending && (target.role === UserRole.STORE_STAFF || target.role === UserRole.DELIVERY_PARTNER)) {
                // KYC must be submitted (not just drafted) before the sign-up goes to the admin.
                const state = await this.kyc.state(this.prisma, target.id);
                if (state.missingSubmitted.length)
                    throw new BadRequestException({
                        message: this.i18n.translate("kyc.errors.docsMissing", { args: { missing: state.missingSubmitted.join(", ") } }),
                        code: "KYC_DOCS_MISSING",
                        missing: state.missingSubmitted,
                        drafts: state.drafts,
                    });
            }
            const request =
                pending ??
                (await this.prisma.$transaction((tx) =>
                    openApproval(tx, actor, {
                        type: ApprovalType.MEMBER_ONBOARDING,
                        storeId: target.storeId,
                        targetType: "User",
                        targetId: target.id,
                        note: "Recommended by store manager",
                        payload: { role: target.role, recommendation: "APPROVE" },
                    }),
                ));
            return { success: true, forwarded: true, approvalId: request.id };
        }

        // Staff / riders: same rule as the approval inbox (KYC complete, pending documents verified with the account).
        if (await this.decideOnboarding(target, actor, true)) return { success: true };

        await this.prisma.user.update({
            where: { id: target.id },
            data: {
                approvalStatus: ApprovalStatus.APPROVED,
                approvedById: actor.id,
                approvedAt: new Date(),
                rejectionReason: null,
            },
        });

        await this.prisma.approvalRequest.updateMany({
            where: { type: ApprovalType.MEMBER_ONBOARDING, targetType: "User", targetId: target.id, status: ApprovalRequestStatus.PENDING },
            data: { status: ApprovalRequestStatus.APPROVED, reviewedById: actor.id, reviewedByRole: actor.role, reviewedAt: new Date() },
        });

        this.audit.log({
            actorId: actor.id,
            actorRole: actor.role,
            storeId: target.storeId,
            action: "user.approve",
            entityType: "User",
            entityId: target.id,
        });

        return { success: true };
    }

    /** Admin decides a staff / rider sign-up directly (closes the MEMBER_ONBOARDING request too). */
    private async decideOnboarding(
        target: { id: bigint; role: UserRole },
        actor: AuthUser,
        approve: boolean,
        note?: string,
    ) {
        if (target.role !== UserRole.STORE_STAFF && target.role !== UserRole.DELIVERY_PARTNER) return false;
        const handler = this.handlers()[ApprovalType.MEMBER_ONBOARDING]!;
        const out = await this.prisma.$transaction(async (tx) => {
            const pending = await pendingFor(tx, ApprovalType.MEMBER_ONBOARDING, "User", target.id);
            const res = (await handler(tx, (pending ?? { targetId: target.id }) as never, { approve, actor, note })) || {};
            if (pending)
                await tx.approvalRequest.update({
                    where: { id: pending.id },
                    data: {
                        status: approve ? ApprovalRequestStatus.APPROVED : ApprovalRequestStatus.REJECTED,
                        reviewedById: actor.id,
                        reviewedByRole: actor.role,
                        reviewNote: note ?? null,
                        reviewedAt: new Date(),
                        result: (res.result ?? {}) as Prisma.InputJsonValue,
                    },
                });
            return res;
        });
        await out.afterCommit?.();
        this.audit.log({
            actorId: actor.id,
            actorRole: actor.role,
            action: approve ? "user.approve" : "user.reject",
            entityType: "User",
            entityId: target.id,
            after: { note },
        });
        return true;
    }

    async reject(targetId: bigint, reason: string, actor: AuthUser) {
        const target = await this.loadApprovable(targetId, actor);
        if (isAdminRole(actor.role) && (await this.decideOnboarding(target, actor, false, reason))) return { success: true };

        await this.prisma.user.update({
            where: { id: target.id },
            data: {
                approvalStatus: ApprovalStatus.REJECTED,
                rejectionReason: reason,
                approvedById: actor.id,
                approvedAt: new Date(),
            },
        });
        // Manager withdraws their own onboarding request.
        await this.prisma.approvalRequest.updateMany({
            where: { type: ApprovalType.MEMBER_ONBOARDING, targetType: "User", targetId: target.id, status: ApprovalRequestStatus.PENDING },
            data: { status: ApprovalRequestStatus.CANCELLED, reviewedById: actor.id, reviewedByRole: actor.role, reviewNote: reason, reviewedAt: new Date() },
        });

        await this.tokens.revokeAllForUser(target.id);

        this.audit.log({
            actorId: actor.id,
            actorRole: actor.role,
            storeId: target.storeId,
            action: "user.reject",
            entityType: "User",
            entityId: target.id,
            after: { reason },
        });

        return { success: true };
    }

    /** Store manager: pending STORE_STAFF / DELIVERY_PARTNER of their store. */
    pendingTeam(storeId: bigint, q: { skip: number; take: number; role?: UserRole }) {
        return this.prisma.user.findMany({
            where: {
                storeId,
                approvalStatus: ApprovalStatus.PENDING,
                deletedAt: null,
                role: q.role ?? { in: [UserRole.STORE_STAFF, UserRole.DELIVERY_PARTNER] },
            },
            select: {
                id: true,
                phone: true,
                name: true,
                role: true,
                storeId: true,
                createdAt: true,
                partnerProfile: { select: { kycStatus: true, vehicleType: true } },
            },
            orderBy: { createdAt: "asc" },
            skip: q.skip,
            take: q.take,
        });
    }

    /** Store manager: their STORE_STAFF / DELIVERY_PARTNER team. */
    team(storeId: bigint, q: { skip: number; take: number; role?: UserRole }) {
        return this.prisma.user.findMany({
            where: {
                storeId,
                deletedAt: null,
                role: q.role ?? { in: [UserRole.STORE_STAFF, UserRole.DELIVERY_PARTNER] },
            },
            select: {
                id: true,
                phone: true,
                name: true,
                role: true,
                status: true,
                approvalStatus: true,
                partnerProfile: {
                    select: { isOnline: true, isAvailable: true, activeOrderCount: true, kycStatus: true },
                },
            },
            orderBy: { id: "desc" },
            skip: q.skip,
            take: q.take,
        });
    }

    /** Store manager: one member of their team, with contact details, duties, hold and KYC state. */
    async teamMember(storeId: bigint, id: bigint) {
        const member = await this.prisma.user.findFirst({
            where: {
                id,
                storeId,
                deletedAt: null,
                role: { in: [UserRole.STORE_STAFF, UserRole.DELIVERY_PARTNER] },
            },
            select: {
                id: true,
                phone: true,
                name: true,
                email: true,
                language: true,
                role: true,
                status: true,
                statusReason: true,
                approvalStatus: true,
                rejectionReason: true,
                storeId: true,
                staffDuties: true,
                hold: true,
                createdById: true,
                lastLoginAt: true,
                createdAt: true,
                partnerProfile: {
                    select: { isOnline: true, isAvailable: true, activeOrderCount: true, kycStatus: true, vehicleType: true, vehicleNumber: true },
                },
            },
        });

        if (!member) this.notFound();

        const [kyc, onboarding] = await Promise.all([
            this.kyc.state(this.prisma, member.id),
            this.prisma.approvalRequest.findFirst({
                where: { type: ApprovalType.MEMBER_ONBOARDING, targetType: "User", targetId: member.id },
                orderBy: { id: "desc" },
                select: { id: true, status: true, reviewNote: true, createdAt: true, reviewedAt: true },
            }),
        ]);

        return { ...member, kyc, onboarding };
    }

    /**
     * Store manager adds a staff member or delivery partner with mandatory KYC.
     * The account is PENDING until an admin approves the MEMBER_ONBOARDING request.
     */
    async createMember(storeId: bigint, dto: CreateTeamMemberInput, actor: AuthUser) {
        const phone = normalizeE164Phone(dto.phone)!;
        await this.assertPhoneFree(phone, dto.role);

        if (dto.role !== UserRole.STORE_STAFF && dto.duties?.length) this.bad("dutiesStaffOnly");
        const submit = dto.submit ?? true;
        const kycDocs = dto.kyc ?? [];
        const missing = submit ? this.kyc.missing(dto.role, dto.vehicleType, kycDocs.map((d) => d.type)) : [];
        if (missing.length)
            throw new BadRequestException({
                message: this.i18n.translate("kyc.errors.docsMissing", { args: { missing: missing.join(", ") } }),
                code: "KYC_DOCS_MISSING",
                missing,
            });

        let created: { id: bigint; approvalId: bigint | null };
        try {
            created = await this.prisma.$transaction(async (tx) => {
                const user = await tx.user.create({
                    data: {
                        role: dto.role,
                        phone,
                        name: dto.name,
                        email: dto.email ?? null,
                        language: dto.language ?? this.locale.defaultLanguage,
                        storeId,
                        createdById: actor.id,
                        staffDuties: dto.role === UserRole.STORE_STAFF ? (dto.duties ?? [StaffDuty.PACKING]) : [],
                        approvalStatus: ApprovalStatus.PENDING,
                        ...(dto.role === UserRole.DELIVERY_PARTNER && {
                            partnerProfile: { create: { vehicleType: dto.vehicleType!, vehicleNumber: dto.vehicleNumber } },
                        }),
                    },
                    select: { id: true },
                });
                if (kycDocs.length) await this.kyc.createDocs(tx, user.id, actor.id, kycDocs, { submitted: submit, actor });
                await this.kyc.recompute(tx, user.id);
                // Draft: the manager finishes KYC first (store/team/{id}/kyc), then submits.
                if (!submit) return { id: user.id, approvalId: null };
                const request = await openApproval(tx, actor, {
                    type: ApprovalType.MEMBER_ONBOARDING,
                    storeId,
                    targetType: "User",
                    targetId: user.id,
                    note: dto.note,
                    payload: { role: dto.role, duties: dto.duties ?? [], kycTypes: kycDocs.map((d) => d.type) },
                    snapshot: { name: dto.name, phone },
                });
                return { id: user.id, approvalId: request.id };
            });
        } catch (error) {
            if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
                this.conflict("phoneTaken", { phone, role: dto.role });
            }
            throw error;
        }

        this.audit.log({
            actorId: actor.id,
            actorRole: actor.role,
            storeId,
            action: "store.member.create",
            entityType: "User",
            entityId: created.id,
            after: { role: dto.role, approvalId: created.approvalId?.toString() ?? null, kycDraft: !submit },
        });

        return { ...(await this.teamMember(storeId, created.id)), approvalId: created.approvalId };
    }

    /** Store manager edits name / email / language / duties of a STORE_STAFF member of their store. */
    async updateStaff(storeId: bigint, id: bigint, dto: UpdateStaffInput, actor: AuthUser) {
        const target = await this.teamMember(storeId, id);

        if (target.role !== UserRole.STORE_STAFF) this.forbidden();

        await this.prisma.user.update({
            where: { id },
            data: {
                name: dto.name,
                email: dto.email === undefined ? undefined : dto.email,
                language: dto.language,
                staffDuties: dto.duties,
            },
        });
        // Duties drive permissions: drop the cached permission set.
        if (dto.duties) await this.redis.del(`perm:${id}`);

        this.audit.log({
            actorId: actor.id,
            actorRole: actor.role,
            storeId,
            action: "store.staff.update",
            entityType: "User",
            entityId: id,
            before: { name: target.name, email: target.email, language: target.language, duties: target.staffDuties },
            after: { name: dto.name, email: dto.email, language: dto.language, duties: dto.duties },
        });

        return this.teamMember(storeId, id);
    }

    // ─── Holds ───────────────────────────────────────────────────────────────

    /** Current hold; a non-ACTIVE account without a hold record counts as an admin hold (legacy). */
    private holdOf(user: { hold: unknown; status: UserStatus }): AccountHold | null {
        if (user.hold) return user.hold as unknown as AccountHold;
        if (user.status !== UserStatus.ACTIVE)
            return { scope: "FULL", restrictions: [], level: "ADMIN", byId: "0", byRole: "ADMIN", note: null, at: "" };
        return null;
    }

    private async loadManageable(targetId: bigint, actor: AuthUser) {
        const target = await this.prisma.user.findFirst({
            where: { id: targetId, deletedAt: null },
            select: { id: true, role: true, storeId: true, hold: true, status: true },
        });
        if (!target) this.notFound();
        if (target.id === actor.id) this.forbidden("cannotManageSelf");
        if (!canManageUser(actor, target)) this.forbidden(actor.role === UserRole.STORE_MANAGER ? "notYourStore" : "forbidden");
        return target;
    }

    private async dropAccountCaches(userId: bigint) {
        await Promise.all([this.redis.del(holdKey(userId)), this.redis.delByPrefix(`u:ok:${userId}:`)]);
    }

    /**
     * Hold an account. Admins: anyone they may manage (ADMIN-level hold).
     * Store managers: their staff / delivery partners (STORE-level hold) —
     * but not while an admin hold is in place.
     * FULL: status SUSPENDED (or BLOCKED), sessions revoked. PARTIAL: listed capabilities only.
     */
    async hold(targetId: bigint, dto: HoldInput, actor: AuthUser, status: UserStatus = UserStatus.SUSPENDED) {
        const target = await this.loadManageable(targetId, actor);
        const current = this.holdOf(target);
        const level: AccountHold["level"] = isAdminRole(actor.role) ? "ADMIN" : "STORE";
        if (current?.level === "ADMIN" && level === "STORE") this.forbidden("heldByAdmin");

        const hold: AccountHold = {
            scope: dto.scope,
            restrictions: dto.scope === "PARTIAL" ? (dto.restrictions ?? []) : [],
            level,
            byId: actor.id.toString(),
            byRole: actor.role,
            note: dto.note,
            at: new Date().toISOString(),
        };
        await this.prisma.user.update({
            where: { id: target.id },
            data: {
                hold: hold as unknown as Prisma.InputJsonValue,
                status: dto.scope === "FULL" ? status : UserStatus.ACTIVE,
                statusReason: dto.note,
            },
        });
        if (dto.scope === "FULL") await this.tokens.revokeAllForUser(target.id);
        await this.dropAccountCaches(target.id);

        this.audit.log({
            actorId: actor.id,
            actorRole: actor.role,
            storeId: target.storeId,
            action: "user.hold",
            entityType: "User",
            entityId: target.id,
            before: current as unknown as Prisma.InputJsonValue,
            after: hold as unknown as Prisma.InputJsonValue,
        });
        return { success: true, hold };
    }

    /** Lift a hold. A STORE-level hold: the store manager or an admin. An ADMIN-level hold: admins only. */
    async release(targetId: bigint, note: string | undefined, actor: AuthUser) {
        const target = await this.loadManageable(targetId, actor);
        const current = this.holdOf(target);
        if (!current) return { success: true, hold: null };
        if (current.level === "ADMIN" && !isAdminRole(actor.role)) this.forbidden("heldByAdmin");

        await this.prisma.user.update({
            where: { id: target.id },
            data: { hold: Prisma.DbNull, status: UserStatus.ACTIVE, statusReason: null },
        });
        await this.dropAccountCaches(target.id);

        this.audit.log({
            actorId: actor.id,
            actorRole: actor.role,
            storeId: target.storeId,
            action: "user.release",
            entityType: "User",
            entityId: target.id,
            before: current as unknown as Prisma.InputJsonValue,
            after: { note: note ?? null },
        });
        return { success: true, hold: null };
    }

    // ─── Work history ────────────────────────────────────────────────────────

    /**
     * Everything a member did, built from the records the work already writes
     * (order events, picks, packs, support messages, stock movements,
     * deliveries, audit log) — no extra rows are stored for it.
     */
    async activity(userId: bigint, q: ActivityInput) {
        const { take, skip, page, limit } = pageParams(q);
        const from = q.from ? new Date(`${q.from.slice(0, 10)}T00:00:00Z`) : new Date(Date.now() - 30 * 86400000);
        const to = q.to ? new Date(Date.parse(`${q.to.slice(0, 10)}T00:00:00Z`) + 86400000) : new Date(Date.now() + 60000);

        const union = Prisma.sql`
            SELECT 'ORDER' AS "group", 'ORDER_' || e.status::text AS kind, e."createdAt" AS at, 'Order' AS "refType", e."orderId" AS "refId", e.note AS detail, NULL::int AS qty
              FROM "OrderEvent" e WHERE e."actorId" = ${userId}
            UNION ALL
            SELECT 'PICK', 'ITEM_PICKED', oi."pickedAt", 'Order', oi."orderId", oi.sku, oi."pickedQty"
              FROM "OrderItem" oi WHERE oi."pickedById" = ${userId} AND oi."pickedAt" IS NOT NULL
            UNION ALL
            SELECT 'PACK', 'ORDER_PACKED', o."packedAt", 'Order', o.id, o."orderNumber", NULL
              FROM "Order" o WHERE o."packedById" = ${userId} AND o."packedAt" IS NOT NULL
            UNION ALL
            SELECT 'SUPPORT', CASE WHEN sm."isInternal" THEN 'SUPPORT_NOTE' ELSE 'SUPPORT_REPLY' END, sm."createdAt", 'SupportTicket', sm."ticketId", NULL, NULL
              FROM "SupportMessage" sm WHERE sm."senderId" = ${userId}
            UNION ALL
            SELECT 'STOCK', 'STOCK_' || m.type::text, m."createdAt", 'StoreProduct', m."storeProductId", m.note, m.quantity
              FROM "StockMovement" m WHERE m."actorId" = ${userId}
            UNION ALL
            SELECT 'DELIVERY', 'DELIVERY_' || d.status::text, d."updatedAt", 'Order', d."orderId", NULL, NULL
              FROM "Delivery" d WHERE d."partnerId" = ${userId}
            UNION ALL
            SELECT 'ACTION', a.action, a."createdAt", a."entityType", NULL, a."entityId", NULL
              FROM "AuditLog" a WHERE a."actorId" = ${userId}`;
        const filter = Prisma.sql`x.at >= ${from} AND x.at < ${to} ${q.kind ? Prisma.sql`AND x."group" = ${q.kind}` : Prisma.empty}`;

        const [items, summary, [{ total }]] = await Promise.all([
            this.prisma.$queryRaw<any[]>`
                SELECT * FROM (${union}) x WHERE ${filter} ORDER BY x.at DESC LIMIT ${take} OFFSET ${skip}`,
            this.prisma.$queryRaw<{ kind: string; count: number; qty: number | null }[]>`
                SELECT x.kind, COUNT(*)::int AS count, SUM(x.qty)::int AS qty FROM (${union}) x
                WHERE x.at >= ${from} AND x.at < ${to} GROUP BY x.kind ORDER BY 2 DESC`,
            this.prisma.$queryRaw<{ total: number }[]>`
                SELECT COUNT(*)::int AS total FROM (${union}) x WHERE ${filter}`,
        ]);
        return {
            from: from.toISOString().slice(0, 10),
            to: new Date(to.getTime() - 86400000).toISOString().slice(0, 10),
            /** Counts per kind in the window (all kinds). */
            summary,
            items,
            total,
            page,
            limit,
        };
    }

    // ─── Approval handlers ───────────────────────────────────────────────────

    handlers(): Partial<Record<ApprovalType, ApprovalHandler>> {
        return {
            [ApprovalType.MEMBER_ONBOARDING]: async (tx, req, { approve, actor, note }) => {
                const user = await tx.user.findUnique({ where: { id: req.targetId }, select: { id: true, approvalStatus: true } });
                if (!user) this.notFound();
                if (approve) {
                    const state = await this.kyc.state(tx, user.id);
                    if (state.missingSubmitted.length)
                        throw new BadRequestException({
                            message: this.i18n.translate("kyc.errors.docsMissing", { args: { missing: state.missingSubmitted.join(", ") } }),
                            code: "KYC_DOCS_MISSING",
                        });
                }
                await tx.user.update({
                    where: { id: user.id },
                    data: {
                        approvalStatus: approve ? ApprovalStatus.APPROVED : ApprovalStatus.REJECTED,
                        approvedById: actor.id,
                        approvedAt: new Date(),
                        rejectionReason: approve ? null : (note ?? null),
                    },
                });
                await this.kyc.verifyAllPending(tx, user.id, actor, approve, note);
                return {
                    result: { approvalStatus: approve ? "APPROVED" : "REJECTED" },
                    afterCommit: async () => {
                        await this.dropAccountCaches(user.id);
                        if (!approve) await this.tokens.revokeAllForUser(user.id);
                    },
                };
            },
        };
    }

    // ─── Enable / disable ────────────────────────────────────────────────────

    /**
     * Kept for the existing status endpoints: ACTIVE = release the hold,
     * SUSPENDED / BLOCKED = FULL hold at the actor's level (see hold()).
     */
    async setStatus(targetId: bigint, status: UserStatus, reason: string | undefined, actor: AuthUser) {
        if (status === UserStatus.ACTIVE) {
            await this.release(targetId, reason, actor);
            return { success: true, status };
        }
        await this.hold(targetId, { scope: "FULL", note: reason ?? status }, actor, status);
        return { success: true, status };
    }

    async unblockOtp(phone: string, role: UserRole, actor: AuthUser) {
        const normalizedPhone = normalizeE164Phone(phone)!;

        await this.otp.unblock(normalizedPhone, role);

        this.audit.log({
            actorId: actor.id,
            actorRole: actor.role,
            action: "otp.unblock",
            entityType: "Otp",
            entityId: normalizedPhone,
        });

        return { success: true };
    }

    // ─── Access roles ────────────────────────────────────────────────────────

    async upsertAccessRole(dto: AccessRoleInput, id?: bigint) {
        const role = id
            ? await this.prisma.accessRole.update({ where: { id }, data: dto })
            : await this.prisma.accessRole.create({ data: dto });

        const users = await this.prisma.user.findMany({ where: { accessRoleId: role.id }, select: { id: true } });
        await this.redis.del(...users.map((user) => `perm:${user.id}`));

        return role;
    }

    listAccessRoles() {
        return this.prisma.accessRole.findMany({ orderBy: { id: "asc" } });
    }

    // ─── Wallet ──────────────────────────────────────────────────────────────

    /** Balance + filtered, paginated ledger (newest first). */
    async wallet(userId: bigint, q: WalletInput & { skip: number; take: number; page: number; limit: number }) {
        const where: Prisma.WalletTransactionWhereInput = {
            userId,
            ...(q.type ? { type: q.type } : {}),
            ...(q.reason ? { reason: q.reason } : {}),
        };

        const [user, items, total] = await Promise.all([
            this.prisma.user.findUnique({ where: { id: userId }, select: { walletBalance: true } }),
            this.prisma.walletTransaction.findMany({
                where,
                orderBy: { id: "desc" },
                skip: q.skip,
                take: q.take,
                select: {
                    id: true,
                    type: true,
                    reason: true,
                    amount: true,
                    balanceAfter: true,
                    orderId: true,
                    note: true,
                    createdAt: true,
                },
            }),
            this.prisma.walletTransaction.count({ where }),
        ]);

        if (!user) this.notFound();

        return {
            currency: this.currency.info,
            balance: this.currency.format(user.walletBalance),
            items: items.map((item) => ({
                ...item,
                amount: this.currency.format(item.amount),
                balanceAfter: this.currency.format(item.balanceAfter),
            })),
            total,
            page: q.page,
            limit: q.limit,
        };
    }

    /** Admin credit / debit with a ledger entry (ADMIN_ADJUSTMENT). */
    async adjustWallet(userId: bigint, dto: WalletAdjustInput, actor: AuthUser) {
        const target = await this.loadUser(userId);
        this.assertCanManage(actor, target);

        const key = dto.idempotencyKey ? `admin:${dto.idempotencyKey}` : undefined;

        if (key && (await this.prisma.walletTransaction.findUnique({ where: { idempotencyKey: key } }))) {
            return { success: true, duplicate: true, ...(await this.walletBalance(userId)) };
        }

        await this.prisma.$transaction(async (tx) => {
            if (dto.type === WalletTxnType.CREDIT) {
                await this.payments.walletCredit(tx, userId, dto.amount, "ADMIN_ADJUSTMENT", undefined, key, actor.id, dto.note);
                return;
            }

            const ok = await this.payments.walletDebit(
                tx, userId, dto.amount, "ADMIN_ADJUSTMENT", undefined, key, actor.id, dto.note,
            );
            if (!ok) this.bad("insufficientBalance");
        });

        this.audit.log({
            actorId: actor.id,
            actorRole: actor.role,
            action: "wallet.adjust",
            entityType: "User",
            entityId: userId,
            after: { type: dto.type, amount: dto.amount, note: dto.note },
        });

        return { success: true, duplicate: false, ...(await this.walletBalance(userId)) };
    }

    private async walletBalance(userId: bigint) {
        const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { walletBalance: true } });
        return { balance: this.currency.format(user.walletBalance) };
    }

    // ─── Me: profile, settings, avatar ───────────────────────────────────────

    async profile(userId: bigint) {
        const user = await this.prisma.user.findFirst({
            where: { id: userId, deletedAt: null },
            select: {
                id: true,
                phone: true,
                name: true,
                email: true,
                role: true,
                language: true,
                settings: true,
                walletBalance: true,
                phoneVerifiedAt: true,
                createdAt: true,
                staffDuties: true,
                hold: true,
                avatar: AVATAR_SELECT,
                store: { select: { id: true, code: true, name: true } },
                _count: { select: { addresses: true, wishlist: true } },
            },
        });

        if (!user) this.notFound();

        const { avatar, walletBalance, settings, _count, ...rest } = user;

        return {
            ...rest,
            avatar: this.avatarView(avatar),
            settings: settingsOf(settings),
            wallet: { currency: this.currency.info, balance: this.currency.format(walletBalance) },
            counts: { addresses: _count.addresses, wishlist: _count.wishlist },
        };
    }

    async updateProfile(userId: bigint, dto: ProfileInput) {
        const data: Prisma.UserUpdateInput = {};

        if (dto.name !== undefined) data.name = dto.name;
        if (dto.email !== undefined) data.email = dto.email;
        if (dto.language !== undefined) data.language = dto.language;

        if (dto.settings) {
            const current = await this.prisma.user.findUnique({ where: { id: userId }, select: { settings: true } });
            const merged = settingsOf(current?.settings);

            if (dto.settings.theme) merged.theme = dto.settings.theme;

            for (const [key, flag] of Object.entries(dto.settings.notifications ?? {})) {
                if (typeof flag === "boolean" && key in merged.notifications) {
                    merged.notifications[key as keyof UserSettings["notifications"]] = flag;
                }
            }

            data.settings = merged as unknown as Prisma.InputJsonValue;
        }

        await this.prisma.user.update({ where: { id: userId }, data });

        return this.profile(userId);
    }

    /** Upload = set: the new image becomes the only avatar, the old one is retired. */
    async setAvatar(user: AuthUser, file: UploadedFile) {
        await this.media.uploadUserAvatar(file, user);
        return this.profile(user.id);
    }

    async removeAvatar(userId: bigint) {
        await this.media.removeUserAvatar(userId);
        return this.profile(userId);
    }

    // ─── Me: change phone (OTP on both numbers) ──────────────────────────────

    /** Sends a code to the current phone AND the new phone; both must be confirmed. */
    async requestPhoneChange(user: AuthUser, newPhoneRaw: string, ctx: OtpCtx) {
        const me = await this.loadUser(user.id);
        const newPhone = normalizeE164Phone(newPhoneRaw)!;

        if (newPhone === me.phone) this.bad("phoneUnchanged");
        await this.assertPhoneFree(newPhone, me.role, me.id);

        const current = await this.otp.send(me.phone, me.role, ctx);
        const next = await this.otp.send(newPhone, me.role, ctx);

        await this.redis.client.set(phoneChangeKey(me.id), newPhone, "EX", this.otpTtlSec);

        return {
            currentPhone: maskPhone(me.phone),
            newPhone,
            expiresInSec: Math.min(current.expiresInSec, next.expiresInSec),
            nextSendInSec: Math.max(current.nextSendInSec, next.nextSendInSec),
            ...(current.devCode || next.devCode
                ? { devCodes: { currentPhone: current.devCode, newPhone: next.devCode } }
                : {}),
        };
    }

    async verifyPhoneChange(user: AuthUser, dto: PhoneChangeVerifyInput, ctx: OtpCtx) {
        const me = await this.loadUser(user.id);
        const newPhone = await this.redis.client.get(phoneChangeKey(me.id));

        if (!newPhone) this.bad("phoneChangeNotRequested");

        // Both throw a translated 401 on a wrong / expired code.
        await this.otp.verify(me.phone, me.role, dto.currentPhoneCode, ctx);
        await this.otp.verify(newPhone, me.role, dto.newPhoneCode, ctx);

        try {
            await this.prisma.user.update({
                where: { id: me.id },
                data: { phone: newPhone, phoneVerifiedAt: new Date() },
            });
        } catch (error) {
            if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
                this.conflict("phoneTaken", { phone: newPhone, role: me.role });
            }
            throw error;
        }

        await this.redis.del(phoneChangeKey(me.id));

        this.audit.log({
            actorId: me.id,
            actorRole: me.role,
            action: "user.phone.change",
            entityType: "User",
            entityId: me.id,
            before: { phone: me.phone },
            after: { phone: newPhone },
        });

        return this.profile(me.id);
    }

    // ─── Me: wishlist ────────────────────────────────────────────────────────

    async wishlist(userId: bigint, language: string, q: WishlistInput & { skip: number; take: number; page: number; limit: number }) {
        const languages = [...new Set([language, this.locale.defaultLanguage])];

        const [rows, total] = await Promise.all([
            this.prisma.wishlistItem.findMany({
                where: { userId },
                orderBy: { createdAt: "desc" },
                skip: q.skip,
                take: q.take,
                select: {
                    createdAt: true,
                    product: {
                        select: {
                            id: true,
                            slug: true,
                            status: true,
                            deletedAt: true,
                            thumbnail: { select: { key: true, isPrivate: true, variants: true } },
                            translations: { where: { lang: { in: languages } }, select: { lang: true, title: true } },
                        },
                    },
                },
            }),
            this.prisma.wishlistItem.count({ where: { userId } }),
        ]);

        const productIds = rows.map((row) => row.product.id);
        const offers = q.storeId && productIds.length
            ? await this.prisma.storeProduct.groupBy({
                  by: ["productId"],
                  where: { storeId: BigInt(q.storeId), productId: { in: productIds }, isActive: true },
                  _min: { sellingPrice: true },
                  _max: { currentMrp: true },
                  _sum: { availableQty: true, reservedQty: true },
              })
            : [];
        const offerOf = new Map(offers.map((offer) => [offer.productId.toString(), offer]));

        const items = rows.map(({ product, createdAt }) => {
            const title =
                product.translations.find((t) => t.lang === language)?.title ||
                product.translations.find((t) => t.lang === this.locale.defaultLanguage)?.title ||
                product.slug;
            const offer = offerOf.get(product.id.toString());
            const available = product.status === ProductStatus.PUBLISHED && !product.deletedAt;
            const sellable = (offer?._sum.availableQty ?? 0) - (offer?._sum.reservedQty ?? 0);

            return {
                productId: product.id,
                slug: product.slug,
                title,
                thumbnailUrl: product.thumbnail ? this.media.urlForVariant(product.thumbnail, "thumb") : null,
                available,
                ...(q.storeId
                    ? {
                          price: offer ? this.currency.formatOrNull(offer._min.sellingPrice) : null,
                          mrp: offer ? this.currency.formatOrNull(offer._max.currentMrp) : null,
                          inStock: available && !!offer && sellable > 0,
                      }
                    : {}),
                addedAt: createdAt,
            };
        });

        return { items, total, page: q.page, limit: q.limit };
    }

    /** Which of the given products are wishlisted (for product cards / lists). */
    async wishlistCheck(userId: bigint, productIds: string[]) {
        const ids = [...new Set(productIds)].map((id) => BigInt(id));
        const rows = await this.prisma.wishlistItem.findMany({
            where: { userId, productId: { in: ids } },
            select: { productId: true },
        });
        const saved = new Set(rows.map((row) => row.productId.toString()));

        return { wishlisted: ids.map((id) => id.toString()).filter((id) => saved.has(id)) };
    }

    async addToWishlist(userId: bigint, productId: bigint) {
        const product = await this.prisma.product.findFirst({
            where: { id: productId, status: ProductStatus.PUBLISHED, deletedAt: null },
            select: { id: true },
        });

        if (!product) this.notFound("productNotFound");

        const exists = await this.prisma.wishlistItem.findUnique({
            where: { userId_productId: { userId, productId } },
            select: { userId: true },
        });

        if (!exists) {
            const count = await this.prisma.wishlistItem.count({ where: { userId } });
            if (count >= MAX_WISHLIST_ITEMS) this.conflict("wishlistFull", { max: MAX_WISHLIST_ITEMS });

            await this.prisma.wishlistItem.createMany({ data: [{ userId, productId }], skipDuplicates: true });
        }

        return { productId, wishlisted: true, count: await this.prisma.wishlistItem.count({ where: { userId } }) };
    }

    async removeFromWishlist(userId: bigint, productId: bigint) {
        await this.prisma.wishlistItem.deleteMany({ where: { userId, productId } });

        return { productId, wishlisted: false, count: await this.prisma.wishlistItem.count({ where: { userId } }) };
    }

    // ─── Customer addresses ──────────────────────────────────────────────────

    addressFormat(language: string) {
        return { countries: this.address.catalog(language) };
    }

    addresses(userId: bigint) {
        return this.prisma.address.findMany({
            where: { userId },
            orderBy: [{ isDefault: "desc" }, { id: "desc" }],
        });
    }

    /** Create or replace an address; country, region, district and postcode are validated. */
    async saveAddress(userId: bigint, dto: AddressInput, id?: bigint) {
        const region = this.address.normalize(dto);
        const receiverPhone = normalizeE164Phone(dto.receiverPhone)!;

        if (!id && (await this.prisma.address.count({ where: { userId } })) >= MAX_ADDRESSES_PER_USER) {
            this.conflict("addressLimitReached", { max: MAX_ADDRESSES_PER_USER });
        }

        const data = {
            label: dto.label ?? null,
            receiverName: dto.receiverName,
            receiverPhone,
            line1: dto.line1,
            line2: dto.line2 ?? null,
            landmark: dto.landmark ?? null,
            city: dto.city,
            ...region,
            latitude: dto.latitude,
            longitude: dto.longitude,
            placeId: dto.placeId ?? null,
        };

        return this.prisma.$transaction(async (tx) => {
            if (id) {
                const existing = await tx.address.findFirst({ where: { id, userId }, select: { isDefault: true } });
                if (!existing) this.notFound("addressNotFound");

                if (dto.isDefault) {
                    await tx.address.updateMany({ where: { userId, isDefault: true, id: { not: id } }, data: { isDefault: false } });
                }

                return tx.address.update({
                    where: { id },
                    data: { ...data, isDefault: dto.isDefault ?? existing.isDefault },
                });
            }

            const isFirst = (await tx.address.count({ where: { userId } })) === 0;
            const makeDefault = !!dto.isDefault || isFirst;

            if (makeDefault) {
                await tx.address.updateMany({ where: { userId, isDefault: true }, data: { isDefault: false } });
            }

            return tx.address.create({ data: { ...data, userId, isDefault: makeDefault } });
        });
    }

    /** Deleting the default address promotes the newest remaining one. */
    async deleteAddress(userId: bigint, id: bigint) {
        await this.prisma.$transaction(async (tx) => {
            const existing = await tx.address.findFirst({ where: { id, userId }, select: { isDefault: true } });
            if (!existing) this.notFound("addressNotFound");

            await tx.address.delete({ where: { id } });

            if (existing.isDefault) {
                const next = await tx.address.findFirst({ where: { userId }, orderBy: { id: "desc" }, select: { id: true } });
                if (next) await tx.address.update({ where: { id: next.id }, data: { isDefault: true } });
            }
        });

        return { success: true };
    }
}
