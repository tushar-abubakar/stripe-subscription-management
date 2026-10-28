import { RedisService } from "@core/redis/redis.service";
import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Tx } from "./inventory.types";

/** Store timezone lookup and product cache busting shared by every inventory service. */
@Injectable()
export class InventoryCacheService {
    private readonly defaultTz: string;

    constructor(
        private readonly redis: RedisService,
        private readonly config: ConfigService,
    ) {
        this.defaultTz = this.config.getOrThrow<string>("app.timezone");
    }

    /** Store timezone, falling back to the service default. Works inside or outside a transaction. */
    async storeTz(db: { store: Tx["store"] }, storeId: bigint) {
        const s = await db.store.findUnique({
            where: { id: storeId },
            select: { timezone: true },
        });
        return s?.timezone ?? this.defaultTz;
    }

    /** Drop cached product pages. Call AFTER the transaction commits. */
    async invalidateProducts(ids: Iterable<bigint>) {
        await Promise.all(
            [...new Set(ids)].map((id) =>
                this.redis.delByPrefix(`prod:${id}:`),
            ),
        );
    }
}
