import { AppConfig } from "@config/config.type";
import { MEDIA_CONFIG } from "@config/mediaProfile.const";
import ms from "ms";

/* -------------------------------------------------------------------------- */
/* Small, strict env parsers. Invalid values fail fast at boot.               */
/* -------------------------------------------------------------------------- */

/** Reads a comma separated list. */
const readList = (value: string | undefined, fallback: string): string[] =>
    (value ?? fallback)
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);

/** Reads an integer env var; throws on garbage instead of silently using NaN. */
const readInt = (name: string, fallback: number, min = 0): number => {
    const raw = process.env[name];

    if (raw === undefined || raw.trim() === "") {
        return fallback;
    }

    const parsed = Number(raw);

    if (!Number.isInteger(parsed) || parsed < min) {
        throw new Error(
            `Invalid ${name}: "${raw}" must be an integer >= ${min}`,
        );
    }

    return parsed;
};

/** Reads a comma separated list of non-negative integers (e.g. "0,0,30,120"). */
const readIntList = (name: string, fallback: number[]): number[] => {
    const raw = process.env[name];

    if (!raw) {
        return fallback;
    }

    const values = raw.split(",").map((item) => Number(item.trim()));

    if (values.some((value) => !Number.isInteger(value) || value < 0)) {
        throw new Error(
            `Invalid ${name}: "${raw}" must be comma separated non-negative integers`,
        );
    }

    return values;
};

/** Reads a duration such as "15m" / "1h" and validates it with `ms`. */
const readDuration = (name: string, fallback: string): string => {
    const raw = process.env[name] ?? fallback;
    const parsed = (ms as unknown as (value: string) => number | undefined)(
        raw,
    );

    if (typeof parsed !== "number" || parsed <= 0) {
        throw new Error(
            `Invalid ${name}: "${raw}" (expected e.g. "15m", "1h")`,
        );
    }

    return raw;
};

const isProduction = process.env.NODE_ENV === "production";

/** In production a secret must be present and reasonably long. */
const readSecret = (name: string): string => {
    const value = process.env[name] ?? "";

    if (isProduction && value.length < 32) {
        throw new Error(`${name} must be at least 32 characters in production`);
    }

    return value;
};

/** Validates an IANA timezone name. */
const readTimezone = (name: string, fallback: string): string => {
    const value = (process.env[name] ?? fallback).trim();

    try {
        new Intl.DateTimeFormat("en", { timeZone: value });
    } catch {
        throw new Error(`Invalid ${name}: "${value}" is not an IANA timezone`);
    }

    return value;
};

/* -------------------------------------------------------------------------- */
/* Language / currency                                                        */
/* -------------------------------------------------------------------------- */

const LANGUAGE_PATTERN = /^[a-z]{2}(?:-[a-z]{2})?$/;

const buildI18nConfig = (): AppConfig["i18n"] => {
    const languages = readList(process.env.LANGUAGES, "en").map((language) =>
        language.toLowerCase(),
    );

    for (const [index, language] of languages.entries()) {
        if (!LANGUAGE_PATTERN.test(language)) {
            throw new Error(`Invalid language code: "${language}"`);
        }

        if (languages.indexOf(language) !== index) {
            throw new Error(`Duplicate language code: "${language}"`);
        }
    }

    // DEFAULT_LANGUAGE is the documented name; FALLBACK_LANGUAGE is kept for
    // backwards compatibility with existing .env files.
    const defaultLanguage = (
        process.env.DEFAULT_LANGUAGE ??
        process.env.FALLBACK_LANGUAGE ??
        languages[0]
    )
        .trim()
        .toLowerCase();

    if (!languages.includes(defaultLanguage)) {
        throw new Error(
            `DEFAULT_LANGUAGE "${defaultLanguage}" must be one of LANGUAGES (${languages.join(", ")})`,
        );
    }

    return { defaultLanguage, languages };
};

const buildCurrencyConfig = (): AppConfig["currency"] => {
    const code = (process.env.DEFAULT_CURRENCY ?? "BDT").trim().toUpperCase();

    if (!/^[A-Z]{3}$/.test(code)) {
        throw new Error(`Invalid DEFAULT_CURRENCY: "${code}" (ISO 4217)`);
    }

    let formatter: Intl.NumberFormat;

    try {
        formatter = new Intl.NumberFormat("en", {
            style: "currency",
            currency: code,
            currencyDisplay: "narrowSymbol",
        });
    } catch {
        throw new Error(`Unknown DEFAULT_CURRENCY: "${code}"`);
    }

    // The symbol can be overridden (CURRENCY_SYMBOL); otherwise it is derived.
    const derivedSymbol =
        formatter.formatToParts(0).find((part) => part.type === "currency")
            ?.value ?? code;

    return {
        code,
        symbol: process.env.CURRENCY_SYMBOL?.trim() || derivedSymbol,
        fractionDigits: formatter.resolvedOptions().maximumFractionDigits ?? 2,
    };
};

/* -------------------------------------------------------------------------- */
/* Configuration factory                                                      */
/* -------------------------------------------------------------------------- */

export default (): AppConfig => {
    const otpMaxCooldownSec = readInt("OTP_MAX_COOLDOWN_SEC", 30 * 60, 1);
    const databaseUrl = process.env.DATABASE_URL ?? "";
    const redisUrl = process.env.REDIS_URL ?? "";

    if (!databaseUrl) {
        throw new Error("DATABASE_URL is required");
    }

    if (!redisUrl) {
        throw new Error("REDIS_URL is required");
    }

    if (process.env.OTP_DEV_ECHO === "true" && isProduction) {
        throw new Error("OTP_DEV_ECHO cannot be enabled in production");
    }

    return {
        // ─── Application ───────────────────────────────────────────────────────
        app: {
            name: process.env.APP_NAME ?? "QC Backend",
            port: readInt("PORT", 3000, 1),
            env: process.env.NODE_ENV ?? "development",
            prefix: (() => {
                const value = (process.env.API_PREFIX || "api/v1").trim();

                if (!/^[a-zA-Z0-9]+(?:[/_-][a-zA-Z0-9]+)*$/.test(value)) {
                    throw new Error(
                        `Invalid API_PREFIX: "${value}". Use only letters, numbers, /, _ or -.`,
                    );
                }

                return value;
            })(),
            timezone: readTimezone("DEFAULT_TIMEZONE", "Asia/Dhaka"),
            corsOrigins: readList(process.env.CORS_ORIGINS, ""),
        },

        // ─── Internationalisation / currency ───────────────────────────────────
        i18n: buildI18nConfig(),
        currency: buildCurrencyConfig(),

        // ─── Database ──────────────────────────────────────────────────────────
        database: { url: databaseUrl },

        // ─── Address ───────────────────────────────────────────────────────────
        address: {
            // Defaults to the phone countries so a single-market setup needs no extra env.
            countries: readList(
                process.env.ADDRESS_COUNTRIES ??
                    process.env.PHONE_ALLOWED_COUNTRIES ??
                    process.env.PHONE_ALLOWED_COUNTRY,
                "BD",
            ).map((country) => country.toUpperCase()),
            googleMapsServerKey: process.env.GOOGLE_MAPS_SERVER_KEY?.trim() ?? "",
            geocodeCacheTtlSec: readInt(
                "GEOCODE_CACHE_TTL_SEC",
                30 * 24 * 3600,
                60,
            ),
        },

        // ─── Phone ─────────────────────────────────────────────────────────────
        phone: {
            allowedCountries: readList(
                process.env.PHONE_ALLOWED_COUNTRIES ??
                    process.env.PHONE_ALLOWED_COUNTRY,
                "BD",
            ).map((country) => country.toUpperCase()),
        },

        // ─── OTP ───────────────────────────────────────────────────────────────
        otp: {
            hmacSecret: readSecret("OTP_HMAC_SECRET"),
            ttlSec: readInt("OTP_TTL_SEC", 300, 30),
            devEcho: process.env.OTP_DEV_ECHO === "true" && !isProduction,
            maxPerDay: readInt("OTP_MAX_PER_DAY", 7, 1),
            baseCooldownSec: readInt("OTP_BASE_COOLDOWN_SEC", 30, 1),
            maxCooldownSec: otpMaxCooldownSec,
            maxVerifyAttempts: readInt("OTP_MAX_VERIFY_ATTEMPTS", 5, 1),
            verifyLockScheduleSec: readIntList(
                "OTP_VERIFY_LOCK_SCHEDULE_SEC",
                [0, 0, 30, 120, 600, 1800],
            ),
            blockAfterFailedDays: readInt("OTP_BLOCK_AFTER_FAILED_DAYS", 2, 1),
        },

        // ─── Password login ────────────────────────────────────────────────────
        auth: {
            passwordMaxFailures: readInt("PASSWORD_MAX_FAILURES", 5, 1),
            passwordLockMinutes: readInt("PASSWORD_LOCK_MINUTES", 15, 1),
        },

        // ─── JWT ───────────────────────────────────────────────────────────────
        jwt: {
            accessTokenSecret: readSecret("JWT_ACCESS_SECRET"),
            accessTokenTtl: readDuration("JWT_ACCESS_TTL", "15m"),
            refreshTokenTtlDays: readInt("JWT_REFRESH_TTL_DAYS", 30, 1),
            challengeSecret: readSecret("JWT_CHALLENGE_SECRET"),
            challengeTokenTtl: readDuration("JWT_CHALLENGE_TTL", "10m"),
        },

        // ─── Cache ─────────────────────────────────────────────────────────────
        cache: {
            redisUrl,
            ttlSec: {
                catalog: readInt("CACHE_CATALOG_TTL_SEC", 600, 1),
                product: readInt("CACHE_PRODUCT_TTL_SEC", 300, 1),
                permissions: readInt("CACHE_PERMISSIONS_TTL_SEC", 300, 1),
                account: readInt("CACHE_ACCOUNT_TTL_SEC", 60, 1),
                storeGeo: readInt("CACHE_STORE_GEO_TTL_SEC", 300, 1),
            },
            lease: {
                leaseMs: readInt("CACHE_LEASE_MS", 5000, 100),
                pollMs: readInt("CACHE_LEASE_POLL_MS", 50, 5),
                maxPolls: readInt("CACHE_LEASE_MAX_POLLS", 60, 1),
            },
        },

        // ─── Media ─────────────────────────────────────────────────────────────
        media: {
            provider: process.env.MEDIA_PROVIDER || "LOCAL",
            localDir: process.env.MEDIA_LOCAL_DIR || "./uploads",
            // Folder inside localDir that holds public files.
            publicDir: process.env.MEDIA_PUBLIC_DIR || "public",
            baseUrl: (
                process.env.MEDIA_PUBLIC_BASE_URL ||
                `http://localhost:${readInt("PORT", 3000, 1)}/media-public`
            ).replace(/\/+$/, ""),
            bucket: process.env.MEDIA_BUCKET || "",
            image: {
                maxBytes: readInt("MEDIA_IMAGE_MAX_BYTES", 10 * 1024 * 1024, 1),
            },
            video: {
                maxBytes: readInt(
                    "MEDIA_VIDEO_MAX_BYTES",
                    100 * 1024 * 1024,
                    1,
                ),
            },
            audio: {
                maxBytes: readInt("MEDIA_AUDIO_MAX_BYTES", 50 * 1024 * 1024, 1),
            },
            document: {
                maxBytes: readInt(
                    "MEDIA_DOCUMENT_MAX_BYTES",
                    15 * 1024 * 1024,
                    1,
                ),
            },
            // Purpose-specific media settings.
            purposes: MEDIA_CONFIG,
            text: {
                titleMaxLen: readInt("MEDIA_TITLE_MAX_LEN", 191, 1),
                altMaxLen: readInt("MEDIA_ALT_MAX_LEN", 255, 1),
            },
            jobs: {
                maxAttempts: readInt("MEDIA_PROCESS_MAX_ATTEMPTS", 3, 1),
                lockTtlSec: readInt("MEDIA_LOCK_TTL_SEC", 300, 10),
                pollIntervalMs: readInt("MEDIA_POLL_INTERVAL_MS", 5000, 500),
                uploadUrlTtlSec: readInt("MEDIA_UPLOAD_URL_TTL_SEC", 900, 60),
                pendingTtlHours: readInt("MEDIA_PENDING_TTL_HOURS", 24, 1),
                failedTtlDays: readInt("MEDIA_FAILED_TTL_DAYS", 7, 1),
                cleanupIntervalMs: readInt(
                    "MEDIA_CLEANUP_INTERVAL_MS",
                    10 * 60_000,
                    10_000,
                ),
                orphanSweepEnabled: process.env.MEDIA_ORPHAN_SWEEP === "true",
                orphanTtlDays: readInt("MEDIA_ORPHAN_TTL_DAYS", 30, 1),
            },
        },

        // ─── Payment ───────────────────────────────────────────────────────────
        payment: {
            gateway: process.env.PAYMENT_GATEWAY ?? "razorpay",
            webhookSecret: process.env.PAYMENT_WEBHOOK_SECRET ?? "",
        },

        // ─── Cart ──────────────────────────────────────────────────────────────
        cart: {
            guestTtlHours: readInt("GUEST_CART_TTL_HOURS", 72, 1),
            userTtlDays: readInt("USER_CART_TTL_DAYS", 30, 1),
            guestCartsPerIpPerHour: readInt(
                "GUEST_CARTS_PER_IP_PER_HOUR",
                20,
                1,
            ),
        },

        // ─── Orders ────────────────────────────────────────────────────────────
        orders: {
            codMaxAmount: readInt("ORDER_COD_MAX_AMOUNT", 5000, 0),
            paymentWindowMinutes: readInt("ORDER_PAYMENT_WINDOW_MIN", 15, 1),
            etaBufferMinutes: readInt("ORDER_ETA_BUFFER_MIN", 15, 0),
        },

        // ─── Delivery ──────────────────────────────────────────────────────────
        delivery: {
            earningPerOrder: readInt("DELIVERY_EARNING", 30, 0),
            maxActiveOrders: readInt("DELIVERY_MAX_ACTIVE_ORDERS", 2, 1),
        },

        // ─── Inventory ─────────────────────────────────────────────────────────
        inventory: {
            lowStockDefault: readInt("INVENTORY_LOW_STOCK_DEFAULT", 5, 0),
            expiringMaxDays: readInt("INVENTORY_EXPIRING_MAX_DAYS", 90, 1),
            expiringDefaultDays: readInt(
                "INVENTORY_EXPIRING_DEFAULT_DAYS",
                7,
                1,
            ),
            expiringLimit: readInt("INVENTORY_EXPIRING_LIMIT", 200, 1),
            receiveTxTimeoutMs: readInt(
                "INVENTORY_RECEIVE_TX_TIMEOUT_MS",
                20000,
                1000,
            ),
            sweepLockTtlSec: readInt("INVENTORY_SWEEP_LOCK_TTL_SEC", 600, 10),
            sweepBatchSize: readInt("INVENTORY_SWEEP_BATCH_SIZE", 500, 1),
        },
    };
};
