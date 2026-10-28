import {
    AccountHold,
    STORE_MANAGER_PERMISSIONS,
    staffPermissions,
} from "@common/authorization/permissions";
import {
    CAPABILITY_KEY,
    IS_PUBLIC,
    PERMS_KEY,
    ROLES_KEY,
} from "@common/decorators/auth.decorator";
import { AuthUser } from "@common/types/auth.type";
import { AppConfig } from "@config/config.type";
import { PrismaService } from "@core/database/prisma.service";
import { RedisService } from "@core/redis/redis.service";
import { TokenService } from "./token.service";
import {
    CanActivate,
    ExecutionContext,
    ForbiddenException,
    Injectable,
    UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Reflector } from "@nestjs/core";
import { ApprovalStatus, UserRole, UserStatus } from "@prisma-client/client";
import { I18nService } from "nestjs-i18n";

const activeKey = (user: AuthUser) =>
    `u:ok:${user.id}:${user.role}:${user.storeId ?? 0}`;

const permissionKey = (userId: bigint) => `perm:${userId.toString()}`;

/** Cached account hold (`null` = no hold). Deleted by UsersService when a hold changes. */
export const holdKey = (userId: bigint | string) => `hold:${userId.toString()}`;

/**
 * Global JWT authentication guard.
 *
 * Responsibilities:
 * 1. Extract Bearer token.
 * 2. Verify JWT through TokenService.
 * 3. Verify account is still active/approved.
 * 4. Verify role and store have not changed.
 * 5. Attach authenticated user to req.user.
 *
 * Public routes:
 * - No token -> continue anonymously.
 * - Valid token -> req.user is populated.
 * - Invalid/revoked token -> continue anonymously.
 *
 * This allows optional authentication on public endpoints.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
    /** How long a positive "account is active" check is cached. */
    private readonly accountTtlSec: number;

    constructor(
        private readonly reflector: Reflector,
        private readonly tokens: TokenService,
        private readonly prisma: PrismaService,
        private readonly redis: RedisService,
        private readonly i18n: I18nService,
        config: ConfigService,
    ) {
        this.accountTtlSec =
            config.getOrThrow<AppConfig["cache"]>("cache").ttlSec.account;
    }

    async canActivate(ctx: ExecutionContext): Promise<boolean> {
        if (ctx.getType() !== "http") {
            return true;
        }

        const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
            ctx.getHandler(),
            ctx.getClass(),
        ]);

        const req = ctx.switchToHttp().getRequest();

        const authorization = req.headers.authorization;

        const token =
            typeof authorization === "string" &&
            authorization.startsWith("Bearer ")
                ? authorization.slice(7).trim()
                : undefined;

        if (!token) {
            if (isPublic) {
                return true;
            }

            throw new UnauthorizedException(
                this.i18n.translate("auth.errors.missingToken"),
            );
        }

        try {
            const user = await this.tokens.verifyAccess(token);
            await this.assertAccountValid(user);
            req.user = user;

            return true;
        } catch (error) {
            /*
             * Public routes support optional authentication.
             *
             * If the supplied token is invalid, simply continue
             * as an anonymous request.
             */
            if (isPublic) {
                return true;
            }

            throw error;
        }
    }

    /**
     * Ensures the account has not been:
     * - suspended
     * - rejected
     * - deleted
     * - moved to another role
     * - moved to another store
     *
     * Result is cached for `CACHE_ACCOUNT_TTL_SEC` seconds.
     */
    private async assertAccountValid(user: AuthUser): Promise<void> {
        const key = activeKey(user);

        if (await this.redis.client.exists(key)) {
            return;
        }

        const account = await this.prisma.user.findFirst({
            where: {
                id: user.id,
                role: user.role,
                storeId: user.storeId,
                status: UserStatus.ACTIVE,
                approvalStatus: ApprovalStatus.APPROVED,
                deletedAt: null,
            },
            select: {
                id: true,
            },
        });

        if (!account) {
            throw new UnauthorizedException(
                this.i18n.translate("auth.errors.accountNotActive"),
            );
        }

        await this.redis.client.set(key, "1", "EX", this.accountTtlSec);
    }
}

/**
 * Checks @Roles(...) metadata.
 */
@Injectable()
export class RolesGuard implements CanActivate {
    constructor(
        private readonly reflector: Reflector,
        private readonly i18n: I18nService,
    ) {}

    canActivate(ctx: ExecutionContext): boolean {
        const roles = this.reflector.getAllAndOverride<UserRole[]>(ROLES_KEY, [
            ctx.getHandler(),
            ctx.getClass(),
        ]);

        if (!roles?.length) {
            return true;
        }

        const req = ctx.switchToHttp().getRequest();

        const user: AuthUser | undefined = req.user;

        if (!user) {
            throw new UnauthorizedException(
                this.i18n.translate("auth.errors.authenticationRequired"),
            );
        }

        if (!roles.includes(user.role)) {
            throw new ForbiddenException(
                this.i18n.translate("auth.errors.roleNotAllowed"),
            );
        }

        return true;
    }
}

/**
 * Checks @Permissions(...) metadata.
 *
 * Rules:
 * - SUPER_ADMIN bypasses all permissions.
 * - ADMIN permissions come from AccessRole.
 * - STORE_MANAGER uses fixed permissions.
 * - STORE_STAFF uses fixed permissions.
 * - Other roles have no permissions.
 *
 * ADMIN permissions are cached (with a lease) for `CACHE_PERMISSIONS_TTL_SEC`.
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
    private readonly permissionTtlSec: number;

    constructor(
        private readonly reflector: Reflector,
        private readonly prisma: PrismaService,
        private readonly redis: RedisService,
        private readonly i18n: I18nService,
        config: ConfigService,
    ) {
        this.permissionTtlSec =
            config.getOrThrow<AppConfig["cache"]>("cache").ttlSec.permissions;
    }

    async permsFor(userId: bigint, role: UserRole): Promise<string[]> {
        if (role === UserRole.STORE_MANAGER) {
            return STORE_MANAGER_PERMISSIONS;
        }

        // Staff permissions depend on their duties (packing / support / inventory).
        if (role === UserRole.STORE_STAFF) {
            return this.redis.cachedLease(
                permissionKey(userId),
                this.permissionTtlSec,
                async () => {
                    const user = await this.prisma.user.findUnique({
                        where: { id: userId },
                        select: { staffDuties: true },
                    });
                    return staffPermissions(user?.staffDuties ?? []);
                },
            );
        }

        if (role !== UserRole.ADMIN) {
            return [];
        }

        // Lease cache: many concurrent requests of one admin trigger one DB read.
        return this.redis.cachedLease(
            permissionKey(userId),
            this.permissionTtlSec,
            async () => {
                const user = await this.prisma.user.findUnique({
                    where: {
                        id: userId,
                    },
                    select: {
                        accessRole: {
                            select: {
                                permissions: true,
                                isActive: true,
                            },
                        },
                    },
                });

                if (!user?.accessRole?.isActive) {
                    return [];
                }

                return Array.isArray(user.accessRole.permissions)
                    ? (user.accessRole.permissions as string[])
                    : [];
            },
        );
    }

    async canActivate(ctx: ExecutionContext): Promise<boolean> {
        const requiredPermissions = this.reflector.getAllAndOverride<string[]>(
            PERMS_KEY,
            [ctx.getHandler(), ctx.getClass()],
        );

        if (!requiredPermissions?.length) {
            return true;
        }

        const req = ctx.switchToHttp().getRequest();

        const user: AuthUser | undefined = req.user;

        if (!user) {
            throw new UnauthorizedException(
                this.i18n.translate("auth.errors.authenticationRequired"),
            );
        }

        if (user.role === UserRole.SUPER_ADMIN) {
            return true;
        }

        const permissions = await this.permsFor(user.id, user.role);

        const available = new Set(permissions);

        const hasAllPermissions = requiredPermissions.every((permission) =>
            available.has(permission),
        );

        if (!hasAllPermissions) {
            throw new ForbiddenException(
                this.i18n.translate("auth.errors.missingPermission"),
            );
        }

        return true;
    }
}


/**
 * Enforces PARTIAL account holds. Endpoints marked with
 * `@Capability("ORDERS")` (etc.) are refused while the signed-in user's
 * hold lists that restriction. FULL holds never get here: the account is
 * SUSPENDED and JwtAuthGuard rejects it.
 */
@Injectable()
export class HoldGuard implements CanActivate {
    constructor(
        private readonly reflector: Reflector,
        private readonly prisma: PrismaService,
        private readonly redis: RedisService,
        private readonly i18n: I18nService,
    ) {}

    async canActivate(ctx: ExecutionContext): Promise<boolean> {
        const needed = this.reflector.getAllAndOverride<string[]>(CAPABILITY_KEY, [
            ctx.getHandler(),
            ctx.getClass(),
        ]);
        if (!needed?.length) return true;

        const user: AuthUser | undefined = ctx.switchToHttp().getRequest().user;
        if (!user) return true;

        // Wrapped in an object so a cached "no hold" (null) is still a cache hit.
        const cached = await this.redis.cachedLease(holdKey(user.id), 60, async () => {
            const row = await this.prisma.user.findUnique({
                where: { id: user.id },
                select: { hold: true },
            });
            return { hold: (row?.hold as unknown as AccountHold | null) ?? null };
        });
        const hold = cached.hold;
        const blocked = hold?.restrictions?.find((r) => needed.includes(r));
        if (blocked) {
            throw new ForbiddenException({
                message: this.i18n.translate("authorization.errors.restricted", {
                    args: { restriction: blocked },
                }),
                code: "ACCOUNT_RESTRICTED",
                restriction: blocked,
                note: hold?.note ?? null,
            });
        }
        return true;
    }
}
