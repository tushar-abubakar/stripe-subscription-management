import { normalizeE164Phone } from "@common/utils/helpers.util";
import { AppConfig } from "@config/config.type";
import { AuditService } from "@core/audit/audit.service";
import { PrismaService } from "@core/database/prisma.service";
import {
    ChallengeVerifyInput,
    DeliveryVerifyOtpInput,
    OtpVerifyDto,
    SendOtpInput,
} from "./auth.types";
import { OtpCtx, OtpService } from "./otp.service";
import { TokenService } from "@core/auth/token.service";
import { CartService } from "@modules/cart/cart.service";
import {
    BadRequestException,
    ForbiddenException,
    Injectable,
    NotFoundException,
    UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
    ApprovalStatus,
    StoreStatus,
    UserRole,
    UserStatus,
} from "@prisma-client/enums";
import * as argon2 from "argon2";
import { I18nService } from "nestjs-i18n";
import { AuthUser } from "@common/types/auth.type";
import { PermissionsGuard } from "@core/auth/auth.guard";

const DUMMY_PASSWORD_HASH =
    "$argon2id$v=19$m=65536,t=3,p=4$NjY6h79gPzuYP/zt67Ie5w$hTeJ/337WUYKAW0Ek87437C38x/tAlZixI/4WgsTcqE";

@Injectable()
export class AuthService {
    /** Password lock-out policy (PASSWORD_MAX_FAILURES / PASSWORD_LOCK_MINUTES). */
    private readonly passwordPolicy: AppConfig["auth"];

    constructor(
        private readonly prisma: PrismaService,
        private readonly otp: OtpService,
        private readonly tokens: TokenService,
        private readonly audit: AuditService,
        private readonly cart: CartService,
        private readonly i18n: I18nService,
        private readonly config: ConfigService,
        private readonly permissions: PermissionsGuard,
    ) {
        this.passwordPolicy = this.config.getOrThrow<AppConfig["auth"]>("auth");
    }

    /** Normalises a phone number to E.164 or throws a translated 400. */
    private phone(phone: string): string {
        const normalized = normalizeE164Phone(phone);

        if (!normalized) {
            throw new BadRequestException(
                this.i18n.translate("auth.errors.invalidPhone"),
            );
        }

        return normalized;
    }

    /**
     * Ensures that the account is still eligible to authenticate.
     * Deleted accounts, inactive accounts, pending applications,
     * and rejected applications must not receive authentication tokens.
     */
    private assertUsable(user: {
        status: UserStatus;
        approvalStatus: ApprovalStatus;
        deletedAt: Date | null;
        statusReason?: string | null;
        rejectionReason?: string | null;
    }): void {
        if (user.deletedAt) {
            throw new UnauthorizedException(
                this.i18n.translate("auth.errors.accountNotFound"),
            );
        }

        if (user.status !== UserStatus.ACTIVE) {
            throw new ForbiddenException(
                this.i18n.translate("auth.errors.accountStatus", {
                    args: {
                        status: user.status.toLowerCase(),
                        reason: user.statusReason ?? "",
                    },
                }),
            );
        }

        if (user.approvalStatus === ApprovalStatus.PENDING) {
            throw new ForbiddenException({
                message: this.i18n.translate("auth.errors.approvalPending"),
                code: "APPROVAL_PENDING",
            });
        }

        if (user.approvalStatus === ApprovalStatus.REJECTED) {
            throw new ForbiddenException({
                message: this.i18n.translate("auth.errors.approvalRejected", {
                    args: {
                        reason: user.rejectionReason ?? "",
                    },
                }),
                code: "APPROVAL_REJECTED",
            });
        }
    }

    /**
     * Sends an OTP for customer, delivery partner,
     * or store staff authentication.
     */
    sendOtp(role: UserRole, dto: SendOtpInput, ctx: OtpCtx) {
        return this.otp.send(this.phone(dto.phone), role, ctx);
    }

    /**
     * Verifies an OTP and either authenticates an existing
     * user or creates a new account for the supported OTP role.
     */
    async verifyOtp(
        role: UserRole,
        dto: OtpVerifyDto,
        ctx: OtpCtx & { ua?: string },
    ) {
        const phone = this.phone(dto.phone);

        await this.otp.verify(phone, role, dto.code, ctx);

        let user = await this.prisma.user.findUnique({
            where: {
                phone_role: {
                    phone,
                    role,
                },
            },
        });

        let isNew = false;

        if (!user) {
            isNew = true;
            user = await this.signup(role, phone, dto);
        }

        this.assertUsable(user);

        await this.prisma.user.update({
            where: {
                id: user.id,
            },
            data: {
                lastLoginAt: new Date(),
                phoneVerifiedAt: user.phoneVerifiedAt ?? new Date(),
            },
        });

        const tokens = await this.tokens.issue(user, {
            ...dto,
            ...ctx,
        });

        if (
            role === UserRole.CUSTOMER &&
            "guestToken" in dto &&
            dto.guestToken
        ) {
            await this.cart
                .mergeGuestCart(dto.guestToken, user.id)
                .catch(() => undefined);
        }

        this.audit.auth({
            phone,
            role,
            userId: user.id,
            event: "LOGIN_SUCCESS",
            success: true,
            ...ctx,
        });

        return {
            isNewUser: isNew,
            user: this.publicUser(user),
            ...tokens,
        };
    }

    /**
     * Creates a new user after successful OTP verification.
     * Customers are approved immediately, while staff and
     * delivery partners require store association and approval.
     */
    private async signup(role: UserRole, phone: string, dto: OtpVerifyDto) {
        if (role === UserRole.CUSTOMER) {
            return this.prisma.user.create({
                data: {
                    phone,
                    role,
                    name: dto.name,
                    approvalStatus: ApprovalStatus.APPROVED,
                },
            });
        }

        if (!("storeId" in dto) || !dto.storeId) {
            throw new BadRequestException(
                this.i18n.translate("auth.errors.storeIdRequired"),
            );
        }

        const store = await this.prisma.store.findUnique({
            where: {
                id: BigInt(dto.storeId),
            },
            select: {
                id: true,
                status: true,
            },
        });

        if (!store || store.status !== StoreStatus.ACTIVE) {
            throw new NotFoundException(
                this.i18n.translate("auth.errors.storeNotAvailable"),
            );
        }

        if (!dto.name) {
            throw new BadRequestException(
                this.i18n.translate("auth.errors.nameRequired"),
            );
        }

        if (
            role === UserRole.DELIVERY_PARTNER &&
            (!("vehicleType" in dto) || !dto.vehicleType)
        ) {
            throw new BadRequestException(
                this.i18n.translate("auth.errors.vehicleTypeRequired"),
            );
        }

        return this.prisma.user.create({
            data: {
                phone,
                role,
                name: dto.name,
                storeId: store.id,
                approvalStatus: ApprovalStatus.PENDING,
                ...(role === UserRole.DELIVERY_PARTNER
                    ? {
                          partnerProfile: {
                              create: {
                                  vehicleType: (dto as DeliveryVerifyOtpInput)
                                      .vehicleType,
                                  vehicleNumber: (dto as DeliveryVerifyOtpInput)
                                      .vehicleNumber,
                              },
                          },
                      }
                    : {}),
            },
        });
    }

    /**
     * Authenticates an administrator or store manager
     * using password verification as the first step.
     * Successful password authentication creates a
     * temporary challenge that requires OTP verification.
     */
    async passwordLogin(
        roles: Extract<UserRole, "ADMIN" | "SUPER_ADMIN" | "STORE_MANAGER">[],
        phoneRaw: string,
        password: string,
        ctx: OtpCtx,
    ) {
        const phone = this.phone(phoneRaw);

        const user = await this.prisma.user.findFirst({
            where: {
                phone,
                role: {
                    in: roles,
                },
                deletedAt: null,
            },
        });

        const bad = () =>
            new UnauthorizedException(
                this.i18n.translate("auth.errors.invalidPhoneOrPassword"),
            );

        /**
         * Performs an Argon2 verification even when the
         * account does not exist or has no password hash.
         * This keeps the approximate processing cost similar
         * and reduces user enumeration through timing attacks.
         */
        if (!user || !user.passwordHash) {
            await argon2
                .verify(DUMMY_PASSWORD_HASH, password)
                .catch(() => false);

            throw bad();
        }

        if (user.passwordLockedUntil && user.passwordLockedUntil > new Date()) {
            throw new ForbiddenException(
                this.i18n.translate("auth.errors.passwordLocked"),
            );
        }

        const passwordValid = await argon2.verify(user.passwordHash, password);

        if (!passwordValid) {
            const fails = user.failedPasswordCount + 1;

            // make password lock if maximum failed attempted reached.
            await this.prisma.user.update({
                where: {
                    id: user.id,
                },
                data: {
                    failedPasswordCount: fails,
                    ...(fails >= this.passwordPolicy.passwordMaxFailures
                        ? {
                              passwordLockedUntil: new Date(
                                  Date.now() +
                                      this.passwordPolicy.passwordLockMinutes *
                                          60_000,
                              ),
                              failedPasswordCount: 0,
                          }
                        : {}),
                },
            });

            this.audit.auth({
                phone,
                role: user.role,
                userId: user.id,
                event: "PASSWORD_FAILED",
                success: false,
                ...ctx,
            });

            throw bad();
        }

        this.assertUsable(user);

        await this.prisma.user.update({
            where: {
                id: user.id,
            },
            data: {
                failedPasswordCount: 0,
                passwordLockedUntil: null,
            },
        });

        this.audit.auth({
            phone,
            role: user.role,
            userId: user.id,
            event: "PASSWORD_OK",
            success: true,
            ...ctx,
        });

        const sent = await this.otp.send(phone, user.role, ctx);

        return {
            challengeToken: this.tokens.signChallenge(user.id, user.role),
            otpRequired: true,
            ...sent,
        };
    }

    /**
     * Verifies the temporary password-login challenge
     * and the OTP before issuing the final session tokens.
     */
    async verifyChallenge(
        roles: Extract<UserRole, "ADMIN" | "SUPER_ADMIN" | "STORE_MANAGER">[],
        dto: ChallengeVerifyInput,
        ctx: OtpCtx,
    ) {
        const challenge = this.tokens.verifyChallenge(dto.challengeToken);

        if (
            !roles.includes(
                challenge.role as Extract<
                    UserRole,
                    "ADMIN" | "SUPER_ADMIN" | "STORE_MANAGER"
                >,
            )
        ) {
            throw new UnauthorizedException(
                this.i18n.translate("auth.errors.invalidChallenge"),
            );
        }

        const user = await this.prisma.user.findUnique({
            where: {
                id: challenge.userId,
            },
        });

        if (!user) {
            throw new UnauthorizedException(
                this.i18n.translate("auth.errors.invalidChallenge"),
            );
        }

        this.assertUsable(user);

        await this.otp.verify(user.phone, user.role, dto.code, ctx);

        await this.prisma.user.update({
            where: {
                id: user.id,
            },
            data: {
                lastLoginAt: new Date(),
                phoneVerifiedAt: user.phoneVerifiedAt ?? new Date(),
            },
        });

        const tokens = await this.tokens.issue(user, {
            ...dto,
            ...ctx,
        });

        this.audit.auth({
            phone: user.phone,
            role: user.role,
            userId: user.id,
            event: "LOGIN_SUCCESS",
            success: true,
            ...ctx,
        });

        return {
            user: this.publicUser(user),
            ...tokens,
        };
    }

    publicUser(user: {
        id: bigint;
        phone: string;
        role: UserRole;
        avatarId: bigint | null;
        name: string | null;
        email: string | null;
        storeId: bigint | null;
        approvalStatus: ApprovalStatus;
        language: string;
    }) {
        return {
            id: user.id.toString(),
            phone: user.phone,
            role: user.role,
            name: user.name,
            email: user.email,
            storeId: user.storeId?.toString() ?? null,
            approvalStatus: user.approvalStatus,
            language: user.language,
            avatarId: user.avatarId?.toString() ?? null,
        };
    }

    /** The signed-in user's profile and effective permissions (GET /auth/me). */
    async me(user: AuthUser) {
        const dbUser = await this.prisma.user.findUniqueOrThrow({
            where: { id: user.id },
        });

        return {
            ...this.publicUser(dbUser),
            permissions: await this.permissions.permsFor(user.id, user.role),
        };
    }
}
