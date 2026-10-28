import { AppConfig } from "@config/config.type";
import { Injectable, OnModuleDestroy } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { randomBytes } from "crypto";
import Redis from "ioredis";

/** Compare-and-delete: only the owner (matching token) may release a lock. */
const RELEASE_LUA = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
else
  return 0
end`;

export interface LeaseOptions {
    /** Lease TTL. If the holder crashes, others are unblocked after this. */
    leaseMs: number;
    /** Poll interval for callers waiting on the lease holder. */
    pollMs: number;
    /** Max polls before a waiter gives up and loads directly. */
    maxPolls: number;
}

@Injectable()
export class RedisService implements OnModuleDestroy {
    readonly client: Redis;

    /** Default lease tuning (`CACHE_LEASE_*` env vars). */
    private readonly leaseDefaults: LeaseOptions;

    constructor(config: ConfigService) {
        const cache = config.getOrThrow<AppConfig["cache"]>("cache");

        this.leaseDefaults = cache.lease;
        this.client = new Redis(cache.redisUrl, {
            maxRetriesPerRequest: 2,
        });
    }

    async onModuleDestroy(): Promise<void> {
        // quit() flushes pending commands; disconnect() would drop them.
        await this.client.quit().catch(() => this.client.disconnect());
    }

    async getJson<T>(key: string): Promise<T | null> {
        const v = await this.client.get(key);
        return v ? (JSON.parse(v) as T) : null;
    }

    async setJson(key: string, val: unknown, ttlSec: number) {
        await this.client.set(
            key,
            JSON.stringify(val, (_, v) =>
                typeof v === "bigint" ? v.toString() : v,
            ),
            "EX",
            ttlSec,
        );
    }

    /** Read-through cache (no stampede protection; prefer `cachedLease` for hot keys). */
    async cached<T>(
        key: string,
        ttlSec: number,
        loader: () => Promise<T>,
    ): Promise<T> {
        const hit = await this.getJson<T>(key);
        if (hit !== null) return hit;
        const val = await loader();
        if (val !== undefined && val !== null)
            await this.setJson(key, val, ttlSec);
        return val;
    }

    /**
     * Read-through cache with a lease (single-flight) to prevent cache stampedes.
     *
     * - Hit                   -> returned immediately.
     * - Miss, lease acquired  -> this caller runs `loader`, caches the result
     *                            (null/undefined are not cached), releases the lease.
     * - Miss, lease held      -> this caller polls until the holder fills the cache,
     *                            or the lease disappears without a value (holder failed
     *                            or result was null), then loads directly.
     * - Holder crashed / slow -> lease auto-expires after `leaseMs`; waiters give up
     *                            after `maxPolls` and load directly (fail-open).
     *
     * Values go through the same JSON round-trip as `cached()`, so BigInt becomes a
     * string and Date becomes an ISO string on cache hits.
     */
    async cachedLease<T>(
        key: string,
        ttlSec: number,
        loader: () => Promise<T>,
        opts: Partial<LeaseOptions> = {},
    ): Promise<T> {
        const { leaseMs, pollMs, maxPolls }: LeaseOptions = {
            ...this.leaseDefaults,
            ...opts,
        };

        const hit = await this.getJson<T>(key);
        if (hit !== null) return hit;

        const release = await this.lock(key, leaseMs, "ms");
        if (release) {
            try {
                // Double-check: another holder may have just filled it.
                const again = await this.getJson<T>(key);
                if (again !== null) return again;

                const val = await loader();
                if (val !== undefined && val !== null)
                    await this.setJson(key, val, ttlSec);
                return val;
            } finally {
                await release();
            }
        }

        for (let i = 0; i < maxPolls; i++) {
            await new Promise((r) => setTimeout(r, pollMs));
            const v = await this.getJson<T>(key);
            if (v !== null) return v;
            // Lease gone and still no value: holder failed or loaded null.
            if (!(await this.client.exists(`lock:${key}`))) break;
        }
        return loader();
    }

    async del(...keys: string[]) {
        if (keys.length) await this.client.del(...keys);
    }

    async delByPrefix(prefix: string) {
        let cursor = "0";
        do {
            const [next, keys] = await this.client.scan(
                cursor,
                "MATCH",
                `${prefix}*`,
                "COUNT",
                200,
            );
            cursor = next;
            if (keys.length) await this.client.del(...keys);
        } while (cursor !== "0");
    }

    /**
     * Simple distributed lock; returns release fn or null if already held.
     * `ttl` is in seconds by default (existing callers unchanged); pass `"ms"` as
     * the third argument for milliseconds. Release is an atomic compare-and-delete.
     */
    async lock(
        key: string,
        ttl = 10,
        unit: "s" | "ms" = "s",
    ): Promise<(() => Promise<void>) | null> {
        const lockKey = `lock:${key}`;
        const token = randomBytes(12).toString("hex");
        const ok =
            unit === "s"
                ? await this.client.set(lockKey, token, "EX", ttl, "NX")
                : await this.client.set(lockKey, token, "PX", ttl, "NX");
        if (!ok) return null;
        return async () => {
            await this.client.eval(RELEASE_LUA, 1, lockKey, token);
        };
    }
}
