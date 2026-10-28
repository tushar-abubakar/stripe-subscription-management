import { AppConfig } from "@config/config.type";
import { RedisService } from "@core/redis/redis.service";
import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

/**
 * Single owner of every catalog Redis key and its invalidation rules.
 *
 * Key conventions:
 *  - `cat:*`            -> global catalog data (tree, brands, flat categories).
 *  - `prod:{id}:{lang}` -> per-product storefront detail.
 *
 * Services never hard-code key strings; they use `CatalogCacheService.keys`.
 */
@Injectable()
export class CatalogCacheService {
    static readonly keys = {
        categoryTree: "cat:tree",
        categoryFlat: "cat:flat",
        brands: "cat:brands",
        product: (id: bigint | number | string, lang: string) =>
            `prod:${id}:${lang}`,
    } as const;

    private readonly ttl: AppConfig["cache"]["ttlSec"];

    constructor(
        private readonly redis: RedisService,
        config: ConfigService,
    ) {
        this.ttl = config.getOrThrow<AppConfig["cache"]>("cache").ttlSec;
    }

    /** Cached read with a lease (single-flight, prevents stampedes). */
    catalog<T>(key: string, loader: () => Promise<T>) {
        return this.redis.cachedLease(key, this.ttl.catalog, loader);
    }

    product<T>(key: string, loader: () => Promise<T>) {
        return this.redis.cachedLease(key, this.ttl.product, loader);
    }

    /** Invalidates global catalog entries (`cat:`). */
    bust() {
        return this.redis.delByPrefix("cat:");
    }

    /**
     * Invalidates global entries AND all product details. Use when category /
     * brand / option names (embedded in product detail) change.
     */
    async bustAll() {
        await Promise.all([
            this.redis.delByPrefix("cat:"),
            this.redis.delByPrefix("prod:"),
        ]);
    }

    /** Invalidates one product's detail in every language. */
    bustProduct(id: bigint | number | string) {
        return this.redis.delByPrefix(`prod:${id}:`);
    }
}
