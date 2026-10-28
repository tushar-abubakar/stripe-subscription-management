import {
    addDays,
    normalizeE164Phone,
    todayInTz,
} from "@common/utils/helpers.util";
import { AppConfig } from "@config/config.type";
import { AuditService } from "@core/audit/audit.service";
import { PrismaService } from "@core/database/prisma.service";
import { RedisService } from "@core/redis/redis.service";
import {
    ForbiddenException,
    HttpException,
    HttpStatus,
    Injectable,
    Logger,
    UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { UserRole } from "@prisma-client/enums";
import { createHmac, randomInt, timingSafeEqual } from "crypto";
import { I18nService } from "nestjs-i18n";

export interface OtpCtx {
    ip?: string;
    deviceId?: string;
    ua?: string;
}

export const OTP_BLOCK_REASON = {
    ADMIN_BLOCK: "ADMIN_BLOCK",
    FRAUD_SUSPECTED: "FRAUD_SUSPECTED",
    ABUSE_DETECTED: "ABUSE_DETECTED",
    OTP_CONSECUTIVE_DAILY_LIMIT: "OTP_CONSECUTIVE_DAILY_LIMIT",
} as const;

@Injectable()
export class OtpService {
    private readonly log = new Logger(OtpService.name);

    private readonly otpConfig: AppConfig["otp"];
    private readonly timezone: string;

    constructor(
        private readonly prisma: PrismaService,
        private readonly redis: RedisService,
        private readonly audit: AuditService,
        private readonly i18n: I18nService,
        private readonly config: ConfigService,
    ) {
        this.otpConfig = this.config.getOrThrow<AppConfig["otp"]>("otp");

        this.timezone = this.config.getOrThrow<string>("app.timezone");
    }

    /**
     * Start of the current calendar day in the configured timezone, as a
     * UTC-midnight `Date` (matches the Postgres DATE column).
     * Using one fixed timezone keeps the "7 per day" window stable no matter
     * where the server runs.
     */
    private startOfToday(): Date {
        return todayInTz(this.timezone);
    }

    private hash(destination: string, role: UserRole, code: string): string {
        return createHmac("sha256", this.otpConfig.hmacSecret)
            .update(`${destination}|${role}|${code}`)
            .digest("hex");
    }

    private getSendCooldown(sendCount: number): number {
        const baseCooldown = Math.max(1, this.otpConfig.baseCooldownSec);

        // 1st send -> base, then base*2, base*4 ... (exponential), capped.
        const exponent = Math.max(0, sendCount - 1);

        return Math.min(
            baseCooldown * 2 ** exponent,
            this.otpConfig.maxCooldownSec,
        );
    }

    private getVerifyLockDuration(verifyAttempts: number): number {
        const schedule = this.otpConfig.verifyLockScheduleSec;
        const index = Math.min(verifyAttempts, schedule.length - 1);

        return schedule[index] ?? 0;
    }

    // SEND OTP
    async send(
        destination: string,
        role: UserRole,
        ctx: OtpCtx = {},
    ): Promise<{
        expiresInSec: number;
        nextSendInSec: number;
        remainingToday: number;
        devCode?: string;
    }> {
        const normalizedDestination = normalizeE164Phone(destination);

        if (!normalizedDestination) {
            throw new HttpException(
                this.i18n.translate("auth.errors.invalidPhone"),
                HttpStatus.BAD_REQUEST,
            );
        }

        const release = await this.redis.lock(
            `otp:${normalizedDestination}:${role}`,
            10,
        );

        if (!release) {
            throw new HttpException(
                this.i18n.translate("otp.errors.requestInProgress"),
                HttpStatus.TOO_MANY_REQUESTS,
            );
        }

        try {
            const now = new Date();
            const today = this.startOfToday();

            let row = await this.prisma.otp.findUnique({
                where: {
                    destination_role: {
                        destination: normalizedDestination,
                        role,
                    },
                },
            });

            if (!row) {
                row = await this.prisma.otp.create({
                    data: {
                        destination: normalizedDestination,
                        role,
                        sendDate: today,
                    },
                });
            }

            if (row.isBlocked && !row.blockedUntil) {
                await this.audit.auth({
                    phone: normalizedDestination,
                    role,
                    event: "OTP_RATE_LIMITED",
                    success: false,
                    reason:
                        row.blockedReason ?? OTP_BLOCK_REASON.ABUSE_DETECTED,
                    ...ctx,
                    ua: ctx.ua,
                });

                throw new ForbiddenException(
                    this.i18n.translate("otp.errors.destinationBlocked"),
                );
            }

            if (row.blockedUntil && row.blockedUntil > now) {
                const retryAfterSec = Math.ceil(
                    (row.blockedUntil.getTime() - now.getTime()) / 1000,
                );

                throw new HttpException(
                    {
                        message: this.i18n.translate(
                            "otp.errors.waitBeforeRequest",
                        ),
                        retryAfterSec,
                    },
                    HttpStatus.TOO_MANY_REQUESTS,
                );
            }

            if (row.blockedUntil && row.blockedUntil <= now) {
                row = await this.prisma.otp.update({
                    where: {
                        id: row.id,
                    },
                    data: {
                        blockedUntil: null,
                        blockedReason: null,
                        verifyAttempts: 0,
                    },
                });
            }

            // new day -> reset counter
            if (row.sendDate.getTime() !== today.getTime()) {
                row = await this.prisma.otp.update({
                    where: {
                        id: row.id,
                    },
                    data: {
                        sendDate: today,
                        sendCountToday: 0,
                        nextSendAt: null,
                    },
                });
            }

            // daily limit reached -> mark failed day (once) and maybe block
            if (row.sendCountToday >= this.otpConfig.maxPerDay) {
                const yesterday = addDays(today, -1);
                const lastFailedTime = row.lastFailedDate?.getTime();

                // Streak of consecutive days on which the daily limit was hit:
                // - already counted today        -> unchanged
                // - last counted yesterday       -> +1
                // - anything older / never       -> restart at 1
                const consecutiveFailedDays =
                    lastFailedTime === today.getTime()
                        ? row.consecutiveFailedDays
                        : lastFailedTime === yesterday.getTime()
                          ? row.consecutiveFailedDays + 1
                          : 1;

                if (
                    consecutiveFailedDays >= this.otpConfig.blockAfterFailedDays
                ) {
                    await this.prisma.otp.update({
                        where: {
                            id: row.id,
                        },
                        data: {
                            isBlocked: true,
                            blockedAt: now,
                            blockedUntil: null,
                            blockedReason:
                                OTP_BLOCK_REASON.OTP_CONSECUTIVE_DAILY_LIMIT,
                            lastFailedDate: today,
                            consecutiveFailedDays,
                        },
                    });

                    await this.audit.auth({
                        phone: normalizedDestination,
                        role,
                        event: "ACCOUNT_BLOCKED",
                        success: false,
                        reason: OTP_BLOCK_REASON.OTP_CONSECUTIVE_DAILY_LIMIT,
                        ...ctx,
                        ua: ctx.ua,
                    });

                    throw new ForbiddenException(
                        this.i18n.translate("otp.errors.repeatedDailyLimit"),
                    );
                }

                await this.prisma.otp.update({
                    where: {
                        id: row.id,
                    },
                    data: {
                        lastFailedDate: today,
                        consecutiveFailedDays,
                    },
                });

                await this.audit.auth({
                    phone: normalizedDestination,
                    role,
                    event: "OTP_RATE_LIMITED",
                    success: false,
                    reason: "OTP_DAILY_LIMIT",
                    ...ctx,
                    ua: ctx.ua,
                });

                throw new HttpException(
                    this.i18n.translate("otp.errors.dailyLimit"),
                    HttpStatus.TOO_MANY_REQUESTS,
                );
            }

            // -------------------------------------------------
            // RESEND COOLDOWN
            // -------------------------------------------------

            if (row.nextSendAt && row.nextSendAt > now) {
                const retryAfterSec = Math.ceil(
                    (row.nextSendAt.getTime() - now.getTime()) / 1000,
                );

                throw new HttpException(
                    {
                        message: this.i18n.translate(
                            "otp.errors.waitBeforeRequest",
                        ),
                        retryAfterSec,
                    },
                    HttpStatus.TOO_MANY_REQUESTS,
                );
            }

            // -------------------------------------------------
            // GENERATE OTP
            // -------------------------------------------------

            const sendCount = row.sendCountToday + 1;

            const cooldownSec = this.getSendCooldown(sendCount);

            const code = String(randomInt(0, 1_000_000)).padStart(6, "0");

            const expiresAt = new Date(
                now.getTime() + this.otpConfig.ttlSec * 1000,
            );

            const nextSendAt = new Date(now.getTime() + cooldownSec * 1000);

            // -------------------------------------------------
            // STORE OTP
            // -------------------------------------------------

            await this.prisma.otp.update({
                where: {
                    id: row.id,
                },
                data: {
                    codeHash: this.hash(normalizedDestination, role, code),

                    expiresAt,

                    verifyAttempts: 0,

                    blockedUntil: null,

                    sendCountToday: sendCount,

                    lastSentAt: now,

                    nextSendAt,
                },
            });

            // -------------------------------------------------
            // SMS DELIVERY
            // -------------------------------------------------

            await this.deliver(normalizedDestination, code);

            // -------------------------------------------------
            // AUDIT
            // -------------------------------------------------

            await this.audit.auth({
                phone: normalizedDestination,
                role,
                event: "OTP_SENT",
                success: true,
                ...ctx,
                ua: ctx.ua,
            });

            return {
                expiresInSec: this.otpConfig.ttlSec,

                nextSendInSec: cooldownSec,

                remainingToday: Math.max(
                    0,
                    this.otpConfig.maxPerDay - sendCount,
                ),

                ...(this.otpConfig.devEcho
                    ? {
                          devCode: code,
                      }
                    : {}),
            };
        } finally {
            await release();
        }
    }

    // VERIFY OTP
    async verify(
        destination: string,
        role: UserRole,
        code: string,
        ctx: OtpCtx = {},
    ): Promise<void> {
        const normalizedDestination = normalizeE164Phone(destination);

        if (!normalizedDestination) {
            throw new HttpException(
                this.i18n.translate("auth.errors.invalidPhone"),
                HttpStatus.BAD_REQUEST,
            );
        }

        const normalizedCode = code.trim();
        if (!/^\d{6}$/.test(normalizedCode)) {
            throw new UnauthorizedException(
                this.i18n.translate("otp.errors.invalidOtp"),
            );
        }

        const now = new Date();
        const row = await this.prisma.otp.findUnique({
            where: {
                destination_role: {
                    destination: normalizedDestination,
                    role,
                },
            },
            select: {
                id: true,
                codeHash: true,
                expiresAt: true,
                verifyAttempts: true,
                isBlocked: true,
                blockedUntil: true,
                blockedReason: true,
            },
        });

        const fail = (reason: string): never => {
            void this.audit.auth({
                phone: normalizedDestination,
                role,
                event: "OTP_FAILED",
                success: false,
                reason,
                ...ctx,
                ua: ctx.ua,
            });

            throw new UnauthorizedException(
                this.i18n.translate("otp.errors.invalidOtp"),
            );
        };

        if (!row || !row.codeHash || !row.expiresAt) {
            return fail("NO_OTP");
        }

        if (row.isBlocked && !row.blockedUntil) {
            await this.audit.auth({
                phone: normalizedDestination,
                role,
                event: "OTP_RATE_LIMITED",
                success: false,
                reason: row.blockedReason ?? OTP_BLOCK_REASON.ABUSE_DETECTED,
                ...ctx,
                ua: ctx.ua,
            });

            throw new ForbiddenException(
                this.i18n.translate("otp.errors.destinationBlocked"),
            );
        }

        // TEMPORARY VERIFICATION LOCK
        if (row.blockedUntil && row.blockedUntil > now) {
            return fail("OTP_TEMPORARY_LOCK");
        }

        // EXPIRED TEMPORARY LOCK
        if (row.blockedUntil && row.blockedUntil <= now) {
            await this.prisma.otp.updateMany({
                where: {
                    id: row.id,
                    blockedUntil: row.blockedUntil,
                },
                data: {
                    blockedUntil: null,
                    blockedReason: null,
                    verifyAttempts: 0,
                },
            });
        }

        // OTP EXPIRED
        if (row.expiresAt <= now) {
            return fail("EXPIRED");
        }

        // MAX VERIFY ATTEMPTS
        if (row.verifyAttempts >= this.otpConfig.maxVerifyAttempts) {
            await this.prisma.otp.updateMany({
                where: {
                    id: row.id,
                    codeHash: row.codeHash,
                    expiresAt: {
                        gt: now,
                    },
                },
                data: {
                    codeHash: null,
                    expiresAt: null,
                    verifyAttempts: 0,
                    blockedUntil: null,
                    blockedReason: null,
                },
            });

            return fail("ATTEMPTS_EXCEEDED");
        }

        // HASH COMPARISON
        const expectedHash = Buffer.from(
            this.hash(normalizedDestination, role, normalizedCode),
            "hex",
        );

        const storedHash = Buffer.from(row.codeHash, "hex");

        const hashMatches =
            expectedHash.length === storedHash.length &&
            timingSafeEqual(expectedHash, storedHash);

        // WRONG OTP
        if (!hashMatches) {
            const nextAttempts = row.verifyAttempts + 1;

            const lockDuration = this.getVerifyLockDuration(nextAttempts);

            const blockedUntil =
                lockDuration > 0
                    ? new Date(now.getTime() + lockDuration * 1000)
                    : null;

            const result = await this.prisma.otp.updateMany({
                where: {
                    id: row.id,

                    codeHash: row.codeHash,

                    expiresAt: {
                        gt: now,
                    },

                    isBlocked: false,

                    OR: [
                        {
                            blockedUntil: null,
                        },
                        {
                            blockedUntil: {
                                lte: now,
                            },
                        },
                    ],
                },

                data: {
                    verifyAttempts: {
                        increment: 1,
                    },

                    ...(blockedUntil
                        ? {
                              blockedUntil,
                          }
                        : {}),
                },
            });

            if (result.count !== 1) {
                return fail("OTP_STATE_CHANGED");
            }

            await this.audit.auth({
                phone: normalizedDestination,
                role,
                event: "OTP_FAILED",
                success: false,

                reason: lockDuration > 0 ? "OTP_VERIFY_LOCK" : "WRONG_CODE",

                ...ctx,
                ua: ctx.ua,
            });

            throw new UnauthorizedException(
                this.i18n.translate("otp.errors.invalidOtp"),
            );
        }

        /**
         * Atomically consume the OTP.
         *
         * Also:
         *
         * - clears the OTP
         * - resets verify attempts
         * - clears temporary lock
         * - records verification
         * - resets the consecutive daily-limit streak
         */
        const result = await this.prisma.otp.updateMany({
            where: {
                id: row.id,
                codeHash: row.codeHash,
                isBlocked: false,
                expiresAt: {
                    gt: now,
                },
                OR: [
                    {
                        blockedUntil: null,
                    },
                    {
                        blockedUntil: {
                            lte: now,
                        },
                    },
                ],
            },
            data: {
                codeHash: null,
                expiresAt: null,
                lastVerifiedAt: now,
                verifyAttempts: 0,
                blockedUntil: null,
                blockedReason: null,
                consecutiveFailedDays: 0,
                lastFailedDate: null,
            },
        });

        // REPLAY / RACE
        if (result.count !== 1) {
            return fail("REPLAY");
        }

        // SUCCESS
        await this.audit.auth({
            phone: normalizedDestination,
            role,
            event: "OTP_VERIFIED",
            success: true,
            ...ctx,
            ua: ctx.ua,
        });
    }

    // ADMIN UNBLOCK
    async unblock(destination: string, role: UserRole): Promise<void> {
        const normalizedDestination = normalizeE164Phone(destination);

        if (!normalizedDestination) {
            throw new HttpException(
                this.i18n.translate("auth.errors.invalidPhone"),
                HttpStatus.BAD_REQUEST,
            );
        }

        await this.prisma.otp.updateMany({
            where: {
                destination: normalizedDestination,
                role,
            },
            data: {
                isBlocked: false,
                blockedAt: null,
                blockedUntil: null,
                blockedReason: null,
                verifyAttempts: 0,
                nextSendAt: null,
                consecutiveFailedDays: 0,
                lastFailedDate: null,
            },
        });

        await this.audit.auth({
            phone: normalizedDestination,
            role,
            event: "OTP_UNBLOCKED",
            success: true,
            reason: "ADMIN_UNBLOCK",
        });
    }

    // ADMIN BLOCK
    async block(
        destination: string,
        role: UserRole,
        reason:
            | typeof OTP_BLOCK_REASON.ADMIN_BLOCK
            | typeof OTP_BLOCK_REASON.FRAUD_SUSPECTED
            | typeof OTP_BLOCK_REASON.ABUSE_DETECTED,
    ): Promise<void> {
        const normalizedDestination = normalizeE164Phone(destination);

        if (!normalizedDestination) {
            throw new HttpException(
                this.i18n.translate("auth.errors.invalidPhone"),
                HttpStatus.BAD_REQUEST,
            );
        }

        await this.prisma.otp.updateMany({
            where: {
                destination: normalizedDestination,
                role,
            },
            data: {
                isBlocked: true,
                blockedAt: new Date(),
                blockedUntil: null,
                blockedReason: reason,
            },
        });

        await this.audit.auth({
            phone: normalizedDestination,
            role,
            event: "ACCOUNT_BLOCKED",
            success: false,
            reason,
        });
    }

    /**
     * SMS provider intentionally remains abstract.
     *
     * Add the selected provider here later.
     */
    private async deliver(destination: string, code: string): Promise<void> {
        if (this.otpConfig.devEcho) {
            this.log.debug(`OTP for ${destination}: ${code}`);
        }

        /*
         * Example later:
         *
         * await this.sms.send(
         *     destination,
         *     message,
         * );
         */
    }
}

/*
                 OTP SERVICE
                      │
       ┌──────────────┼──────────────┐
       │              │              │
       ▼              ▼              ▼
  SEND LIMIT     VERIFY LIMIT    ADMIN BLOCK
       │              │              │
       ▼              ▼              ▼
     429        temporary lock   permanent block
                    │
                    ▼
             current OTP dies
 */
