/**
 * Strongly typed shape of everything returned by `configuration.ts`.
 *
 * Every tunable value of the application lives here so that no service
 * has to read `process.env` directly. Read values through `ConfigService`,
 * e.g. `config.getOrThrow<AppConfig["currency"]>("currency")`.
 */
import { MEDIA_CONFIG } from "@config/mediaProfile.const";

export type AppConfig = {
    // ─── Application ───────────────────────────────────────────────────────────
    app: {
        name: string;
        port: number;
        env: string;
        /** Global route prefix, e.g. "api/v1". */
        prefix: string;
        /** IANA timezone used for "today" calculations (OTP day window, expiry sweeps). */
        timezone: string;
        /** Allowed CORS origins. An empty list allows every origin (development only). */
        corsOrigins: string[];
    };

    // ─── Internationalisation ──────────────────────────────────────────────────
    i18n: {
        /** Always one of `languages`. Required for every translatable field. */
        defaultLanguage: string;
        /** Languages supported by the platform (loaded from env, no database). */
        languages: string[];
    };

    // ─── Currency ──────────────────────────────────────────────────────────────
    currency: {
        /** ISO 4217 code, e.g. "INR". */
        code: string;
        /** Display symbol, e.g. "₹". */
        symbol: string;
        /** Number of decimals shown for amounts (INR = 2, JPY = 0). */
        fractionDigits: number;
    };

    // ─── Database ──────────────────────────────────────────────────────────────
    database: {
        url: string;
    };

    // ─── Address ───────────────────────────────────────────────────────────────
    address: {
        /**
         * ISO 3166-1 alpha-2 countries stores (and addresses) may be in.
         * Each one needs an entry in `core/address/address.data.ts`.
         */
        countries: string[];
        /** Google Geocoding API server key. Empty disables reverse geocoding. */
        googleMapsServerKey: string;
        /** How long a reverse-geocoded address is cached (Google allows up to 30 days). */
        geocodeCacheTtlSec: number;
    };

    // ─── Phone ─────────────────────────────────────────────────────────────────
    phone: {
        /** ISO 3166-1 alpha-2 countries whose numbers are accepted (E.164 only). */
        allowedCountries: string[];
    };

    // ─── OTP ───────────────────────────────────────────────────────────────────
    otp: {
        hmacSecret: string;
        ttlSec: number;
        /** Returns the OTP in the API response. Never allowed in production. */
        devEcho: boolean;
        /** Maximum OTP sends per phone+role per day. */
        maxPerDay: number;
        /** First resend delay. Every further send doubles it (exponential back-off). */
        baseCooldownSec: number;
        /** Upper bound of the exponential resend delay. */
        maxCooldownSec: number;
        /** Wrong-code attempts allowed per issued OTP. */
        maxVerifyAttempts: number;
        /** Lock (seconds) after N wrong codes. Index = number of failed attempts. */
        verifyLockScheduleSec: number[];
        /** Consecutive days of hitting the daily limit before a permanent block. */
        blockAfterFailedDays: number;
    };

    // ─── Password login (admin / store manager) ────────────────────────────────
    auth: {
        passwordMaxFailures: number;
        passwordLockMinutes: number;
    };

    // ─── JWT ───────────────────────────────────────────────────────────────────
    jwt: {
        accessTokenSecret: string;
        accessTokenTtl: string;
        refreshTokenTtlDays: number;
        challengeSecret: string;
        challengeTokenTtl: string;
    };

    // ─── Cache (Redis) ─────────────────────────────────────────────────────────
    cache: {
        redisUrl: string;
        ttlSec: {
            /** Category tree / brands / flat categories. */
            catalog: number;
            /** Per-product storefront detail. */
            product: number;
            /** Admin permission set. */
            permissions: number;
            /** "Account is active" flag and session validity flags. */
            account: number;
            /** Store resolution by location. */
            storeGeo: number;
        };
        /** Lease (single-flight) tuning used by `RedisService.cachedLease`. */
        lease: {
            leaseMs: number;
            pollMs: number;
            maxPolls: number;
        };
    };

    // ─── Media ─────────────────────────────────────────────────────────────────
    media: {
        provider: string;
        localDir: string;
        publicDir: string;
        baseUrl: string;
        bucket: string;

        /** Global maximum upload sizes, regardless of purpose. */
        image: {
            maxBytes: number;
        };
        video: {
            maxBytes: number;
        };
        audio: {
            maxBytes: number;
        };
        document: {
            maxBytes: number;
        };

        /** Purpose-specific image profiles and audio/video constraints. */
        purposes: typeof MEDIA_CONFIG;

        text: {
            titleMaxLen: number;
            altMaxLen: number;
        };

        jobs: {
            maxAttempts: number;
            lockTtlSec: number;
            pollIntervalMs: number;
            uploadUrlTtlSec: number;
            pendingTtlHours: number;
            failedTtlDays: number;
            cleanupIntervalMs: number;
            orphanSweepEnabled: boolean;
            orphanTtlDays: number;
        };
    };

    // ─── Payment ───────────────────────────────────────────────────────────────
    payment: {
        gateway: string;
        webhookSecret: string;
    };

    // ─── Cart ──────────────────────────────────────────────────────────────────
    cart: {
        guestTtlHours: number;
        userTtlDays: number;
        /** New guest carts one IP may create per hour (keeps the cart table lean). */
        guestCartsPerIpPerHour: number;
    };

    // ─── Orders ────────────────────────────────────────────────────────────────
    orders: {
        /** Largest order total payable by cash on delivery. */
        codMaxAmount: number;
        /** Minutes a customer has to complete an online payment. */
        paymentWindowMinutes: number;
        /** Extra minutes added to the store prep time for the customer ETA. */
        etaBufferMinutes: number;
    };

    // ─── Delivery ──────────────────────────────────────────────────────────────
    delivery: {
        /** Flat earning credited to a partner per completed delivery. */
        earningPerOrder: number;
        /** Orders one partner may hold at the same time. */
        maxActiveOrders: number;
    };

    // ─── Inventory ─────────────────────────────────────────────────────────────
    inventory: {
        lowStockDefault: number;
        expiringMaxDays: number;
        expiringDefaultDays: number;
        expiringLimit: number;
        receiveTxTimeoutMs: number;
        sweepLockTtlSec: number;
        sweepBatchSize: number;
    };
};
