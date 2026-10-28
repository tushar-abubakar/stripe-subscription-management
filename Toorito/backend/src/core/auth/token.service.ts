import { AuthUser } from "@common/types/auth.type";
import { randomToken, sha256 } from "@common/utils/helpers.util";
import { AppConfig } from "@config/config.type";
import { PrismaService } from "@core/database/prisma.service";
import { RedisService } from "@core/redis/redis.service";
import { Injectable, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import {
    ApprovalStatus,
    User,
    UserRole,
    UserStatus,
} from "@prisma-client/client";
import { randomUUID } from "crypto";
import ms from "ms";
import { I18nService } from "nestjs-i18n";

export interface DeviceInfo {
    deviceId?: string;
    deviceName?: string;
    platform?: string;
    appVersion?: string;
    pushToken?: string;
    ip?: string;
    ua?: string;
}

interface AccessTokenPayload {
    sub: string;
    role: UserRole;
    sid: string;
    st: string | null;
    jti: string;
    exp: number;
}

interface ChallengeTokenPayload {
    sub: string;
    role: string;
    typ: "otp-challenge";
    exp: number;
}

const BL = (jti: string) => `bl:jti:${jti}`;
const SESS = (sid: string) => `sess:ok:${sid}`;

@Injectable()
export class TokenService {
    private readonly jwtConfig: AppConfig["jwt"];
    private readonly accessTokenTtlSec: number;

    constructor(
        private readonly jwt: JwtService,
        private readonly prisma: PrismaService,
        private readonly redis: RedisService,
        private readonly config: ConfigService,
        private readonly i18n: I18nService,
    ) {
        this.jwtConfig = this.config.getOrThrow<AppConfig["jwt"]>("jwt");

        const parsedAccessTtl = ms(
            this.jwtConfig.accessTokenTtl as ms.StringValue,
        );

        if (typeof parsedAccessTtl !== "number") {
            throw new Error(
                `Invalid JWT_ACCESS_TTL: "${this.jwtConfig.accessTokenTtl}"`,
            );
        }

        this.accessTokenTtlSec = Math.floor(parsedAccessTtl / 1000);

        if (this.accessTokenTtlSec <= 0) {
            throw new Error(
                `JWT_ACCESS_TTL must be greater than 0: "${this.jwtConfig.accessTokenTtl}"`,
            );
        }
    }

    /**
     * Creates a new access token.
     */
    private signAccess(
        user: Pick<User, "id" | "role" | "storeId">,
        sid: bigint,
        jti: string = randomUUID(),
    ) {
        const token = this.jwt.sign(
            {
                sub: user.id.toString(),
                role: user.role,
                sid: sid.toString(),
                st: user.storeId?.toString() ?? null,
                jti,
            },
            {
                secret: this.jwtConfig.accessTokenSecret,
                expiresIn: this.jwtConfig.accessTokenTtl as ms.StringValue,
            },
        );

        return {
            token,
            jti,
        };
    }

    /**
     * New login:
     * Creates a session and returns access + refresh tokens + expire time.
     */
    async issue(
        user: Pick<User, "id" | "role" | "storeId">,
        dev: DeviceInfo = {},
    ) {
        const refreshToken = randomToken(48);
        const refreshTokenHash = sha256(refreshToken);
        const jti = randomUUID();

        const session = await this.prisma.session.create({
            data: {
                userId: user.id,
                refreshTokenHash,
                accessTokenJti: jti,
                deviceId: dev.deviceId,
                deviceName: dev.deviceName,
                platform: dev.platform,
                appVersion: dev.appVersion,
                pushToken: dev.pushToken,
                ipAddress: dev.ip,
                userAgent: dev.ua?.slice(0, 255),
                expiresAt: new Date(
                    Date.now() + this.jwtConfig.refreshTokenTtlDays * 86400000,
                ),
            },
        });

        const { token } = this.signAccess(user, session.id, jti);

        return {
            accessToken: token,
            refreshToken,
            expiresIn: this.jwtConfig.accessTokenTtl,
        };
    }

    /**
     * Refresh-token rotation.
     *
     * The database update is conditional on the old
     * refresh-token hash, preventing concurrent requests
     * from successfully rotating the same token.
     */
    async refresh(refreshToken: string, dev: DeviceInfo = {}) {
        const currentHash = sha256(refreshToken);

        const session = await this.prisma.session.findUnique({
            where: {
                refreshTokenHash: currentHash,
            },
            include: {
                user: true,
            },
        });

        if (!session || session.revokedAt || session.expiresAt < new Date()) {
            throw new UnauthorizedException(
                this.i18n.translate("auth.errors.sessionExpired"),
            );
        }

        if (
            session.user.status !== UserStatus.ACTIVE ||
            session.user.deletedAt ||
            session.user.approvalStatus !== ApprovalStatus.APPROVED
        ) {
            throw new UnauthorizedException(
                this.i18n.translate("auth.errors.accountNotActive"),
            );
        }

        const nextRefreshToken = randomToken(48);
        const nextRefreshTokenHash = sha256(nextRefreshToken);
        const nextJti = randomUUID();

        /*
         * Only one request can successfully replace
         * the current refresh token.
         */
        const updateResult = await this.prisma.session.updateMany({
            where: {
                id: session.id,
                refreshTokenHash: currentHash,
                revokedAt: null,
            },
            data: {
                refreshTokenHash: nextRefreshTokenHash,
                accessTokenJti: nextJti,
                lastUsedAt: new Date(),
                pushToken: dev.pushToken ?? session.pushToken,
                ipAddress: dev.ip ?? session.ipAddress,
            },
        });

        if (updateResult.count !== 1) {
            throw new UnauthorizedException(
                this.i18n.translate("auth.errors.sessionExpired"),
            );
        }

        /*
         * Retire the previous access token.
         */
        if (session.accessTokenJti) {
            await this.blacklist(
                session.accessTokenJti,
                this.accessTokenTtlSec,
            );
        }

        const { token } = this.signAccess(session.user, session.id, nextJti);

        /*
         * The session cache must be refreshed because this session is still valid after rotation.
         */
        await this.redis.client.set(SESS(session.id.toString()), "1", "EX", 60);

        return {
            accessToken: token,
            refreshToken: nextRefreshToken,
            expiresIn: this.jwtConfig.accessTokenTtl,
        };
    }

    /**
     * Blacklists an access-token JTI until its natural expiration.
     */
    async blacklist(jti: string, ttlSec: number) {
        if (ttlSec <= 0) {
            return;
        }

        await this.redis.client.set(BL(jti), "1", "EX", ttlSec);
    }

    /**
     * Logout:
     * - Revokes the current session.
     * - Blacklists the current access token.
     * - Removes the session cache.
     */
    async logout(user: AuthUser) {
        await this.prisma.session.updateMany({
            where: {
                id: BigInt(user.sid),
                userId: user.id,
                revokedAt: null,
            },
            data: {
                revokedAt: new Date(),
            },
        });

        const remainingTtl = user.exp - Math.floor(Date.now() / 1000);

        await this.blacklist(user.jti, remainingTtl);

        await this.redis.del(SESS(user.sid));
    }

    /**
     * Revokes all active sessions belonging to a user.
     */
    async revokeAllForUser(userId: bigint) {
        const sessions = await this.prisma.session.findMany({
            where: {
                userId,
                revokedAt: null,
            },
            select: {
                id: true,
                accessTokenJti: true,
            },
        });

        await this.prisma.session.updateMany({
            where: {
                userId,
                revokedAt: null,
            },
            data: {
                revokedAt: new Date(),
            },
        });

        for (const session of sessions) {
            if (session.accessTokenJti) {
                await this.blacklist(
                    session.accessTokenJti,
                    this.accessTokenTtlSec,
                );
            }

            await this.redis.del(SESS(session.id.toString()));
        }
    }

    /**
     * Verifies an access token:
     * - JWT signature
     * - JWT expiration
     * - JTI blacklist
     * - Session validity
     *
     * Session validity is cached in Redis for 60 seconds.
     */
    async verifyAccess(token: string): Promise<AuthUser> {
        let payload: AccessTokenPayload;

        try {
            payload = this.jwt.verify<AccessTokenPayload>(token, {
                secret: this.jwtConfig.accessTokenSecret,
            });
        } catch {
            throw new UnauthorizedException(
                this.i18n.translate("auth.errors.invalidToken"),
            );
        }

        if (!payload.jti || !payload.sub || !payload.sid || !payload.role) {
            throw new UnauthorizedException(
                this.i18n.translate("auth.errors.invalidToken"),
            );
        }

        if (await this.redis.client.exists(BL(payload.jti))) {
            throw new UnauthorizedException(
                this.i18n.translate("auth.errors.tokenRevoked"),
            );
        }

        const sessionKey = SESS(payload.sid);

        const sessionCached = await this.redis.client.get(sessionKey);

        if (!sessionCached) {
            const session = await this.prisma.session.findUnique({
                where: {
                    id: BigInt(payload.sid),
                },
                select: {
                    revokedAt: true,
                    expiresAt: true,
                },
            });

            if (
                !session ||
                session.revokedAt ||
                session.expiresAt < new Date()
            ) {
                throw new UnauthorizedException(
                    this.i18n.translate("auth.errors.sessionRevoked"),
                );
            }

            await this.redis.client.set(sessionKey, "1", "EX", 60);
        }

        return {
            id: BigInt(payload.sub),
            role: payload.role,
            storeId: payload.st ? BigInt(payload.st) : null,
            sid: payload.sid,
            jti: payload.jti,
            exp: payload.exp,
        };
    }

    /**
     * Creates a short-lived challenge token after
     * the password step has been completed.
     */
    signChallenge(userId: bigint, role: string) {
        return this.jwt.sign(
            {
                sub: userId.toString(),
                role,
                typ: "otp-challenge",
            },
            {
                secret: this.jwtConfig.challengeSecret,
                expiresIn: this.jwtConfig.challengeTokenTtl as ms.StringValue,
            },
        );
    }

    /**
     * Verifies a challenge token.
     */
    verifyChallenge(token: string): {
        userId: bigint;
        role: string;
    } {
        try {
            const payload = this.jwt.verify<ChallengeTokenPayload>(token, {
                secret: this.jwtConfig.challengeSecret,
            });

            if (payload.typ !== "otp-challenge") {
                throw new Error();
            }

            return {
                userId: BigInt(payload.sub),
                role: payload.role,
            };
        } catch {
            throw new UnauthorizedException(
                this.i18n.translate("auth.errors.challengeExpired"),
            );
        }
    }
}
