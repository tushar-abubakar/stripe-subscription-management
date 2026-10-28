import { RedisService } from "@core/redis/redis.service";
import {
    BadRequestException,
    ConflictException,
    Injectable,
    NotFoundException,
} from "@nestjs/common";
import { createHash } from "crypto";
import { I18nService } from "nestjs-i18n";
import { LayoutIssue } from "./schema/contract";

/** JSON with sorted keys: same content → same string → same checksum. */
export function stableStringify(value: unknown): string {
    if (value === null || typeof value !== "object")
        return JSON.stringify(value);
    if (Array.isArray(value))
        return `[${value.map(stableStringify).join(",")}]`;
    return `{${Object.keys(value as object)
        .filter((k) => (value as Record<string, unknown>)[k] !== undefined)
        .sort()
        .map(
            (k) =>
                `${JSON.stringify(k)}:${stableStringify((value as Record<string, unknown>)[k])}`,
        )
        .join(",")}}`;
}

export const checksum = (value: unknown) =>
    createHash("sha256").update(stableStringify(value)).digest("hex");

/** JSON-safe copy (bigint → string, Date → ISO) for Redis / Json columns. */
export const plain = <T>(value: T): T =>
    JSON.parse(
        JSON.stringify(value, (_k, v) =>
            typeof v === "bigint" ? v.toString() : v,
        ),
    ) as T;

/** Small in-process TTL map (L1) with an entry cap; oldest entries go first. */
class Memo {
    private readonly map = new Map<string, { v: unknown; exp: number }>();
    constructor(private readonly max: number) {}
    get<T>(key: string): T | undefined {
        const e = this.map.get(key);
        if (!e) return undefined;
        if (e.exp <= Date.now()) {
            this.map.delete(key);
            return undefined;
        }
        return e.v as T;
    }
    set(key: string, v: unknown, ms: number) {
        if (ms <= 0) return;
        if (this.map.size >= this.max)
            this.map.delete(this.map.keys().next().value!);
        this.map.set(key, { v, exp: Date.now() + ms });
    }
}

/** Stored in Redis as { v } so "nothing there" (null) is cached too. */
interface Box<T> {
    v: T;
}

export interface CacheOpts {
    /** Also keep it in process memory this long (ms). Only for values that can't change under the same key. */
    localMs?: number;
}

/**
 * SDUI caching (all app-facing reads go through here):
 *
 * - Two levels: L1 = process memory (a few seconds to minutes, no network), L2 = Redis (shared by all instances).
 * - Generation: every key holding admin-made config (screen meta, rules, saved sections, groups, media,
 *   rendered screens) contains `sdui:gen`. Any change customers can see (publish, make live, rules,
 *   screen on/off, saved section / group edit, scheduled publish) calls bump(), so old entries are simply
 *   never read again and expire on their own: no scans, no deletes, no races. Published layouts are immutable,
 *   so they are cached by version id without the generation.
 * - The generation itself is read from Redis at most once per GEN_LOCAL_MS per instance
 *   (worst case another instance sees a publish that much later).
 * - Single flight: concurrent misses of one key in a process share one load, and across instances a Redis
 *   lease lets one instance load while the others wait for its value (no stampede after a publish).
 */
@Injectable()
export class SduiCache {
    private static readonly GEN = "sdui:gen";
    private static readonly GEN_LOCAL_MS = 1000;
    private genValue: { v: number; exp: number } | null = null;
    private readonly l1 = new Memo(5000);
    private readonly inflight = new Map<string, Promise<unknown>>();

    constructor(private readonly redis: RedisService) {}

    async gen(): Promise<number> {
        if (this.genValue && this.genValue.exp > Date.now())
            return this.genValue.v;
        const v = Number((await this.redis.client.get(SduiCache.GEN)) ?? 0);
        this.genValue = { v, exp: Date.now() + SduiCache.GEN_LOCAL_MS };
        return v;
    }

    /** Invalidate everything the app reads (call after any change customers can see). */
    async bump(): Promise<number> {
        const v = await this.redis.client.incr(SduiCache.GEN);
        this.genValue = { v, exp: Date.now() + SduiCache.GEN_LOCAL_MS };
        return v;
    }

    /** Read-through cache with a fixed TTL; null results are cached as well. */
    cached<T>(
        key: string,
        ttlSec: number,
        load: () => Promise<T>,
        opts: CacheOpts = {},
    ): Promise<T> {
        return this.cachedTtl(
            key,
            async () => ({ value: await load(), ttlSec }),
            opts,
        );
    }

    /**
     * Read-through cache whose loader decides the TTL (e.g. a rendered screen lives until the next
     * visibility / schedule / flash-sale boundary). ttlSec <= 0 = don't store.
     */
    async cachedTtl<T>(
        key: string,
        load: () => Promise<{ value: T; ttlSec: number }>,
        opts: CacheOpts = {},
    ): Promise<T> {
        const local = this.l1.get<Box<T>>(key);
        if (local) return local.v;
        const running = this.inflight.get(key) as Promise<T> | undefined;
        if (running) return running;
        const p = this.fromRedis(key, load, opts).finally(() =>
            this.inflight.delete(key),
        );
        this.inflight.set(key, p);
        return p;
    }

    private async fromRedis<T>(
        key: string,
        load: () => Promise<{ value: T; ttlSec: number }>,
        opts: CacheOpts,
    ): Promise<T> {
        const keep = (box: Box<T>, ttlSec: number) => {
            if (opts.localMs)
                this.l1.set(key, box, Math.min(opts.localMs, ttlSec * 1000));
            return box.v;
        };
        const hit = await this.readBox<T>(key);
        if (hit) return keep(hit.box, hit.ttl);

        const fill = async () => {
            const { value, ttlSec } = await load();
            const box = { v: plain(value) };
            const ttl = Math.floor(ttlSec);
            if (ttl > 0)
                await this.redis.client.set(
                    key,
                    JSON.stringify(box),
                    "EX",
                    ttl,
                );
            return keep(box, ttl);
        };
        const release = await this.redis.lock(key, 5000, "ms");
        if (release) {
            try {
                const again = await this.readBox<T>(key);
                return again ? keep(again.box, again.ttl) : await fill();
            } finally {
                await release();
            }
        }
        for (let i = 0; i < 40; i++) {
            await new Promise((r) => setTimeout(r, 50));
            const v = await this.readBox<T>(key);
            if (v) return keep(v.box, v.ttl);
            if (!(await this.redis.client.exists(`lock:${key}`))) break;
        }
        return fill();
    }

    private async readBox<T>(
        key: string,
    ): Promise<{ box: Box<T>; ttl: number } | null> {
        const [[, raw], [, ttl]] = (await this.redis.client
            .multi()
            .get(key)
            .ttl(key)
            .exec()) as [[unknown, string | null], [unknown, number]];
        if (!raw) return null;
        try {
            return { box: JSON.parse(raw) as Box<T>, ttl: ttl > 0 ? ttl : 1 };
        } catch {
            return null;
        }
    }
}

/** Translated errors with stable codes. */
@Injectable()
export class SduiErrors {
    constructor(private readonly i18n: I18nService) {}

    t(key: string, args?: Record<string, unknown>) {
        return this.i18n.translate(
            `sdui.${key}`,
            args ? { args } : {},
        ) as string;
    }
    notFound(what: "screen" | "version" | "rule" | "section" | "group"): never {
        throw new NotFoundException({
            message: this.t(`errors.${what}NotFound`),
            code: `${what.toUpperCase()}_NOT_FOUND`,
        });
    }
    bad(
        key: string,
        code: string,
        extra: Record<string, unknown> = {},
        args?: Record<string, unknown>,
    ): never {
        throw new BadRequestException({
            message: this.t(`errors.${key}`, args),
            code,
            ...extra,
        });
    }
    conflict(
        key: string,
        code: string,
        extra: Record<string, unknown> = {},
        args?: Record<string, unknown>,
    ): never {
        throw new ConflictException({
            message: this.t(`errors.${key}`, args),
            code,
            ...extra,
        });
    }
    invalid(errors: LayoutIssue[], warnings: LayoutIssue[] = []): never {
        throw new BadRequestException({
            message: this.t("errors.invalidLayout", { count: errors.length }),
            code: "SDUI_INVALID",
            errors,
            warnings,
        });
    }
}
