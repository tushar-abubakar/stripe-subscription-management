import { num } from "@common/utils/helpers.util";
import { CurrencyService } from "@core/currency/currency.service";
import { PrismaService } from "@core/database/prisma.service";
import { LocaleService } from "@core/locale/locale.service";
import {
    CatalogBrowseService,
} from "@modules/inventory/catalog-browse.service";
import { flashState } from "@modules/inventory/inventory.util";
import { MediaService } from "@modules/media/media.service";
import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Prisma } from "@prisma-client/client";
import {
    BrandStatus,
    CategoryStatus,
    MediaStatus,
    SduiGroupKind,
} from "@prisma-client/enums";
import { SDUI_LIMITS } from "../schema/contract";
import { checksum, SduiCache } from "../sdui.util";
import { EntityConf, GroupConf, SduiConfigService } from "./config.service";
import { EntityQuery, RenderContext, SourcePage } from "./render.types";
import { Boundary, scheduleOn, windowEndsAt } from "./time-window";

interface ProductFilter {
    categoryIds?: string[];
    brandIds?: string[];
    newWithinDays?: number;
    flashOnly?: boolean;
    inStockOnly?: boolean;
    minDiscountPct?: number;
    minPrice?: number;
    maxPrice?: number;
    sort?: string;
}
/** Which products: exactly `only` (in that order), or anything matching one of `any` (hand-picked first). */
interface Scope {
    only?: bigint[];
    any?: { productIds: bigint[]; categoryIds: bigint[]; brandIds: bigint[] };
}
/** What a landing page is opened for. */
export type ResolvedEntity =
    | { type: "group"; group: GroupConf }
    | { type: "category" | "brand"; entity: EntityConf };

/** Data pages: short, they carry stock and prices. Never longer than the next flash-sale start / end. */
const DATA_TTL = 30;
const PERSONAL_TTL = 120;
const LIVE_TTL = 60;
const LIVE_FLASH = Prisma.sql`(sp."flashPrice" IS NOT NULL AND sp."flashStartsAt" <= now() AND sp."flashEndsAt" > now()
    AND (sp."flashQtyLimit" IS NULL OR sp."flashSoldQty" < sp."flashQtyLimit"))`;
const LIVE_LISTING = Prisma.sql`sp."isActive" AND v."isActive" AND v."deletedAt" IS NULL AND p.status = 'PUBLISHED' AND p."deletedAt" IS NULL`;

const encodeCursor = (offset: number) =>
    Buffer.from(JSON.stringify({ o: offset })).toString("base64url");
export const decodeCursor = (cursor?: string | null) => {
    if (!cursor) return 0;
    try {
        const o = Number(
            JSON.parse(Buffer.from(cursor, "base64url").toString()).o,
        );
        return Number.isInteger(o) && o >= 0 && o < 10_000 ? o : 0;
    } catch {
        return 0;
    }
};
const ids = (xs: unknown) =>
    Array.isArray(xs)
        ? xs
              .filter((x) => /^[0-9]{1,19}$/.test(String(x)))
              .map((x) => BigInt(x as string))
        : [];
const ttlUntil = (base: number, validUntil?: string | null) =>
    validUntil
        ? Math.max(
              1,
              Math.min(
                  base,
                  Math.ceil(
                      (new Date(validUntil).getTime() - Date.now()) / 1000,
                  ),
              ),
          )
        : base;

/**
 * Fills sections with live data of the user's store. Every product shown has a live listing (active listing,
 * variant and published product), priced like the cart (flash price while a flash sale runs, never above MRP).
 * Pages are cached per store / language / source definition (+ the custom group's revision), so editing a
 * group changes the key at once; buy-again is per user.
 */
@Injectable()
export class DataSourcesService {
    private readonly tz: string;

    constructor(
        private readonly prisma: PrismaService,
        private readonly cache: SduiCache,
        private readonly config: SduiConfigService,
        private readonly locale: LocaleService,
        private readonly currency: CurrencyService,
        private readonly media: MediaService,
        private readonly browse: CatalogBrowseService,
        appConfig: ConfigService,
    ) {
        this.tz = appConfig.getOrThrow<string>("app.timezone");
    }

    get timezone() {
        return this.tz;
    }

    /** The custom group is on now (records when that changes). */
    groupOn(g: GroupConf, now: Date, b?: Boundary) {
        return scheduleOn(g.schedule, now, this.tz, b);
    }

    /**
     * One page of a section's source. `groups` must hold the groups the source names (the renderer loads them
     * once per screen); `entity` / `query` only for the `entity` source on landing pages.
     */
    async resolve(
        source: Record<string, unknown> & { type: string },
        ctx: RenderContext,
        opts: {
            cursor?: string | null;
            groups?: Map<string, GroupConf>;
            entity?: ResolvedEntity;
            query?: EntityQuery;
        } = {},
    ): Promise<SourcePage> {
        const limit = Math.min(
            Number(source.limit ?? 12) || 12,
            SDUI_LIMITS.maxItems,
        );
        const offset = decodeCursor(opts.cursor);
        const now = ctx.now ?? new Date();

        if (source.type === "groups")
            return this.groupTiles(
                (source.keys as string[]) ?? [],
                opts.groups ?? new Map(),
                ctx,
                now,
            );
        if (!ctx.storeId)
            return { items: [], next: null, meta: { reason: "NO_STORE" } };

        let def: Record<string, unknown> = source;
        if (source.type === "group") {
            const g = opts.groups?.get(String(source.key));
            if (!g || !scheduleOn(g.schedule, now, this.tz))
                return { items: [], next: null, meta: { reason: "GROUP_OFF" } };
            def = { ...source, rev: g.rev };
        } else if (source.type === "entity") {
            if (!opts.entity) return { items: [], next: null };
            def = {
                ...source,
                entity: this.entityKey(opts.entity),
                query: opts.query ?? {},
            };
        } else if (source.type === "reorder" && !ctx.userId)
            return {
                items: [],
                next: null,
                meta: { reason: "LOGIN_REQUIRED" },
            };

        const personal = source.type === "reorder";
        const key = `sdui:ds:${ctx.storeId}:${ctx.lang}:${personal ? `u${ctx.userId}:` : ""}${checksum(def).slice(0, 20)}:${limit}:${offset}`;
        return this.cache.cachedTtl(
            key,
            async () => {
                const page = await this.load(source, ctx, limit, offset, opts);
                return {
                    value: page,
                    ttlSec: ttlUntil(
                        personal ? PERSONAL_TTL : DATA_TTL,
                        page.validUntil,
                    ),
                };
            },
            { localMs: personal ? 0 : 3000 },
        );
    }

    private entityKey(e: ResolvedEntity) {
        return e.type === "group"
            ? `g:${e.group.key}:${e.group.rev}`
            : `${e.type[0]}:${e.entity.id}`;
    }

    private async load(
        source: Record<string, unknown> & { type: string },
        ctx: RenderContext,
        limit: number,
        offset: number,
        opts: {
            groups?: Map<string, GroupConf>;
            entity?: ResolvedEntity;
            query?: EntityQuery;
        },
    ): Promise<SourcePage> {
        const storeId = ctx.storeId!;
        switch (source.type) {
            case "products":
                return this.productPage(
                    storeId,
                    ctx.lang,
                    source as ProductFilter,
                    limit,
                    offset,
                );
            case "group":
                return this.groupItems(
                    opts.groups!.get(String(source.key))!,
                    storeId,
                    ctx.lang,
                    limit,
                    offset,
                );
            case "flash_sale": {
                const page = await this.productPage(
                    storeId,
                    ctx.lang,
                    {
                        flashOnly: true,
                        inStockOnly: true,
                        sort: "flash_ending",
                        categoryIds: source.categoryIds as string[],
                    },
                    limit,
                    offset,
                );
                const ends = page.items
                    .flatMap((p) =>
                        (
                            p.variants as {
                                flashSale: { endsAt: string } | null;
                            }[]
                        ).map((v) => v.flashSale?.endsAt),
                    )
                    .filter(Boolean)
                    .sort();
                return { ...page, meta: { endsAt: ends[0] ?? null } };
            }
            case "reorder": {
                const rows = await this.prisma.$queryRaw<{ pid: bigint }[]>`
                    SELECT oi."productId" AS pid
                    FROM "OrderItem" oi JOIN "Order" o ON o.id = oi."orderId"
                    WHERE o."userId" = ${ctx.userId} AND o."storeId" = ${storeId} AND o.status = 'DELIVERED'
                      AND o."placedAt" > now() - interval '90 days' AND oi."productId" IS NOT NULL
                    GROUP BY 1 ORDER BY MAX(o."placedAt") DESC LIMIT 100`;
                return this.productPage(
                    storeId,
                    ctx.lang,
                    { inStockOnly: false, sort: "manual" },
                    limit,
                    offset,
                    { only: rows.map((r) => r.pid) },
                );
            }
            case "categories":
                return this.categoryPage(
                    storeId,
                    ctx.lang,
                    ids(source.ids),
                    source.parentId as string | undefined,
                    limit,
                    offset,
                );
            case "brands":
                return this.brandPage(
                    storeId,
                    ctx.lang,
                    ids(source.ids),
                    source.categoryIds as string[] | undefined,
                    limit,
                    offset,
                );
            case "entity":
                return this.entityProducts(
                    opts.entity!,
                    storeId,
                    ctx.lang,
                    opts.query ?? {},
                    source.sort as string | undefined,
                    limit,
                    offset,
                );
            default:
                return { items: [], next: null };
        }
    }

    // ---------------------------------------------------------------------
    // Custom groups
    // ---------------------------------------------------------------------

    /** Tiles of custom groups that are on now (tap → open_group). Changes only with the schedule. */
    private async groupTiles(
        keys: string[],
        groups: Map<string, GroupConf>,
        ctx: RenderContext,
        now: Date,
    ): Promise<SourcePage> {
        const b = new Boundary();
        const on = keys
            .map((k) => groups.get(k))
            .filter(
                (g): g is GroupConf =>
                    !!g && scheduleOn(g.schedule, now, this.tz, b),
            );
        const media = await this.config.media(
            on
                .flatMap((g) => [
                    g.media?.cover?.mediaId,
                    g.media?.icon?.mediaId,
                ])
                .filter((x): x is string => !!x),
        );
        return {
            items: on.map((g) => ({
                kind: "group",
                groupKey: g.key,
                title: this.locale.pick(g.title, ctx.lang),
                subtitle: g.subtitle
                    ? this.locale.pick(g.subtitle, ctx.lang)
                    : null,
                image: media.get(g.media?.cover?.mediaId ?? "") ?? null,
                icon: media.get(g.media?.icon?.mediaId ?? "") ?? null,
                endsAt: windowEndsAt(g.schedule, now, this.tz),
                action: { type: "open_group", key: g.key },
            })),
            next: null,
            validUntil: Number.isFinite(b.sec)
                ? new Date(now.getTime() + b.sec * 1000).toISOString()
                : null,
        };
    }

    /** Rail of a group: RULE = products; MANUAL = its products / categories / brands in the admin's order. */
    private async groupItems(
        g: GroupConf,
        storeId: bigint,
        lang: string,
        limit: number,
        offset: number,
    ): Promise<SourcePage> {
        if (g.kind === SduiGroupKind.RULE)
            return this.productPage(
                storeId,
                lang,
                (g.rule ?? {}) as ProductFilter,
                limit,
                offset,
            );
        const productIds = ids(
            g.items.filter((i) => i.type === "product").map((i) => i.id),
        );
        const [liveProducts, liveCats, liveBrands] = await Promise.all([
            productIds.length
                ? this.productIds(
                      storeId,
                      { inStockOnly: false, sort: "manual" },
                      200,
                      0,
                      { only: productIds },
                  ).then((r) => new Set(r.rows.map((x) => x.pid.toString())))
                : new Set<string>(),
            this.liveCategoryIds(storeId).then((x) => new Set(x)),
            this.liveBrandIds(storeId).then((x) => new Set(x)),
        ]);
        const shown = g.items.filter((i) =>
            (i.type === "product"
                ? liveProducts
                : i.type === "category"
                  ? liveCats
                  : liveBrands
            ).has(i.id),
        );
        const page = shown.slice(offset, offset + limit);
        const [cards, cats, brands] = await Promise.all([
            this.productCards(
                storeId,
                lang,
                ids(page.filter((i) => i.type === "product").map((i) => i.id)),
            ),
            this.categoryTiles(
                lang,
                ids(page.filter((i) => i.type === "category").map((i) => i.id)),
            ),
            this.brandTiles(
                lang,
                ids(page.filter((i) => i.type === "brand").map((i) => i.id)),
            ),
        ]);
        const find = (i: {
            type: string;
            id: string;
        }): Record<string, any> | undefined =>
            i.type === "product"
                ? cards.find((c) => c.productId === i.id)
                : i.type === "category"
                  ? cats.find((c) => c.categoryId === i.id)
                  : brands.find((c) => c.brandId === i.id);
        const items = page
            .map(find)
            .filter((x): x is Record<string, any> => !!x);
        return {
            items,
            next:
                shown.length > offset + limit
                    ? encodeCursor(offset + limit)
                    : null,
            total: shown.length,
            validUntil: this.earliestFlashChange(cards),
        };
    }

    // ---------------------------------------------------------------------
    // Landing pages (entity source + filters)
    // ---------------------------------------------------------------------

    /** Base scope / filter of what a landing page lists. */
    private async entityScope(
        e: ResolvedEntity,
    ): Promise<{ filter: ProductFilter; scope?: Scope; defaultSort: string }> {
        if (e.type !== "group")
            return {
                filter:
                    e.type === "category"
                        ? { categoryIds: [e.entity.id], inStockOnly: false }
                        : { brandIds: [e.entity.id], inStockOnly: false },
                defaultSort: "bestselling",
            };
        const g = e.group;
        const landingSort = (g.landing?.sort as string[] | undefined)?.[0];
        if (g.kind === SduiGroupKind.RULE)
            return {
                filter: { ...(g.rule as ProductFilter) },
                defaultSort:
                    landingSort ??
                    String((g.rule as ProductFilter)?.sort ?? "bestselling"),
            };
        const of = (t: string) =>
            ids(g.items.filter((i) => i.type === t).map((i) => i.id));
        return {
            filter: { inStockOnly: false },
            scope: {
                any: {
                    productIds: of("product"),
                    categoryIds: await this.browse.withDescendants(
                        of("category"),
                    ),
                    brandIds: of("brand"),
                },
            },
            defaultSort: landingSort ?? "manual",
        };
    }

    private async entityProducts(
        e: ResolvedEntity,
        storeId: bigint,
        lang: string,
        q: EntityQuery,
        sourceSort: string | undefined,
        limit: number,
        offset: number,
    ) {
        const { filter, scope, defaultSort } = await this.entityScope(e);
        const narrowed: ProductFilter = {
            ...filter,
            sort: q.sort ?? sourceSort ?? defaultSort,
            ...(q.categoryId && { categoryIds: [q.categoryId] }),
            ...(q.brandId && { brandIds: [q.brandId] }),
            ...(q.minPrice !== undefined && { minPrice: q.minPrice }),
            ...(q.maxPrice !== undefined && { maxPrice: q.maxPrice }),
            ...(q.minDiscountPct !== undefined && {
                minDiscountPct: Math.max(
                    q.minDiscountPct,
                    filter.minDiscountPct ?? 0,
                ),
            }),
        };
        // A narrowing category must stay inside the page's own category / group.
        if (q.categoryId && filter.categoryIds?.length) {
            const allowed = new Set(
                (
                    await this.browse.withDescendants(
                        filter.categoryIds.map(BigInt),
                    )
                ).map(String),
            );
            if (!allowed.has(q.categoryId))
                return { items: [], next: null, total: 0 };
        }
        if (
            q.brandId &&
            filter.brandIds?.length &&
            !filter.brandIds.includes(q.brandId)
        )
            return { items: [], next: null, total: 0 };
        return this.productPage(storeId, lang, narrowed, limit, offset, scope);
    }

    /** filter_bar options of a landing page: categories / brands with counts and the price range (cached 60 s). */
    async facets(e: ResolvedEntity, ctx: RenderContext) {
        if (!ctx.storeId) return { categories: [], brands: [], price: null };
        const storeId = ctx.storeId;
        return this.cache.cached(
            `sdui:facets:${storeId}:${ctx.lang}:${this.entityKey(e)}`,
            LIVE_TTL,
            async () => {
                const { filter, scope } = await this.entityScope(e);
                const where = await this.listingWhere(storeId, filter, scope);
                const rows = await this.prisma.$queryRaw<
                    {
                        cid: bigint | null;
                        bid: bigint | null;
                        n: number;
                        lo: unknown;
                        hi: unknown;
                    }[]
                >`
                    SELECT p."categoryId" AS cid, p."brandId" AS bid, COUNT(DISTINCT p.id)::int AS n, MIN(sp."sellingPrice") AS lo, MAX(sp."sellingPrice") AS hi
                    FROM "StoreProduct" sp JOIN "Product" p ON p.id = sp."productId" JOIN "ProductVariant" v ON v.id = sp."variantId"
                    WHERE ${where} GROUP BY 1, 2`;
                const count = (key: "cid" | "bid") => {
                    const m = new Map<string, number>();
                    for (const r of rows)
                        if (r[key])
                            m.set(
                                r[key]!.toString(),
                                (m.get(r[key]!.toString()) ?? 0) + r.n,
                            );
                    return m;
                };
                const cats = count("cid");
                const brands = count("bid");
                const [catRows, brandRows] = await Promise.all([
                    this.prisma.category.findMany({
                        where: {
                            id: { in: [...cats.keys()].map(BigInt) },
                            status: CategoryStatus.ACTIVE,
                        },
                        select: { id: true, name: true },
                    }),
                    this.prisma.brand.findMany({
                        where: {
                            id: { in: [...brands.keys()].map(BigInt) },
                            status: BrandStatus.ACTIVE,
                        },
                        select: { id: true, name: true },
                    }),
                ]);
                const prices = rows
                    .flatMap((r) => [num(r.lo), num(r.hi)])
                    .filter((x) => x > 0);
                return {
                    categories: catRows
                        .map((c) => ({
                            id: c.id.toString(),
                            name: this.locale.pick(c.name, ctx.lang),
                            count: cats.get(c.id.toString()) ?? 0,
                        }))
                        .sort((a, b) => b.count - a.count),
                    brands: brandRows
                        .map((b) => ({
                            id: b.id.toString(),
                            name: this.locale.pick(b.name, ctx.lang),
                            count: brands.get(b.id.toString()) ?? 0,
                        }))
                        .sort((a, b) => b.count - a.count),
                    price: prices.length
                        ? {
                              min: Math.floor(Math.min(...prices)),
                              max: Math.ceil(Math.max(...prices)),
                          }
                        : null,
                };
            },
            { localMs: 5000 },
        );
    }

    // ---------------------------------------------------------------------
    // Products
    // ---------------------------------------------------------------------

    private async listingWhere(
        storeId: bigint,
        f: ProductFilter,
        scope?: Scope,
    ) {
        const categoryIds = f.categoryIds?.length
            ? await this.browse.withDescendants(ids(f.categoryIds))
            : [];
        const anyParts = scope?.any
            ? [
                  ...(scope.any.productIds.length
                      ? [
                            Prisma.sql`sp."productId" IN (${Prisma.join(scope.any.productIds)})`,
                        ]
                      : []),
                  ...(scope.any.categoryIds.length
                      ? [
                            Prisma.sql`p."categoryId" IN (${Prisma.join(scope.any.categoryIds)})`,
                        ]
                      : []),
                  ...(scope.any.brandIds.length
                      ? [
                            Prisma.sql`p."brandId" IN (${Prisma.join(scope.any.brandIds)})`,
                        ]
                      : []),
              ]
            : [];
        return Prisma.sql`sp."storeId" = ${storeId} AND ${LIVE_LISTING}
            ${categoryIds.length ? Prisma.sql`AND p."categoryId" IN (${Prisma.join(categoryIds)})` : Prisma.empty}
            ${f.brandIds?.length ? Prisma.sql`AND p."brandId" IN (${Prisma.join(ids(f.brandIds))})` : Prisma.empty}
            ${scope?.only ? Prisma.sql`AND sp."productId" IN (${Prisma.join(scope.only.length ? scope.only : [0n])})` : Prisma.empty}
            ${scope?.any ? (anyParts.length ? Prisma.sql`AND (${Prisma.join(anyParts, " OR ")})` : Prisma.sql`AND false`) : Prisma.empty}`;
    }

    /** Ordered product ids with a live listing matching the filter (+1 to know if there's more) and the total. */
    private async productIds(
        storeId: bigint,
        f: ProductFilter,
        limit: number,
        offset: number,
        scope?: Scope,
    ) {
        const where = await this.listingWhere(storeId, f, scope);
        const sort = f.sort ?? "bestselling";
        const pinned = scope?.only ?? scope?.any?.productIds ?? [];
        const having = [
            ...(f.inStockOnly !== false ? [Prisma.sql`l.stock > 0`] : []),
            ...(f.flashOnly ? [Prisma.sql`l.flash`] : []),
            ...(f.minDiscountPct
                ? [Prisma.sql`l.discount >= ${f.minDiscountPct / 100}`]
                : []),
            ...(f.maxPrice ? [Prisma.sql`l.price <= ${f.maxPrice}`] : []),
            ...(f.minPrice ? [Prisma.sql`l.price >= ${f.minPrice}`] : []),
            ...(f.newWithinDays
                ? [
                      Prisma.sql`l.listed >= now() - make_interval(days => ${f.newWithinDays}::int)`,
                  ]
                : []),
        ];
        const order =
            sort === "manual"
                ? pinned.length
                    ? Prisma.sql`array_position(${pinned}::bigint[], l.pid) NULLS LAST, COALESCE(s.qty, 0) DESC, l.pid DESC`
                    : Prisma.sql`COALESCE(s.qty, 0) DESC, l.pid DESC`
                : sort === "price_asc"
                  ? Prisma.sql`l.price ASC, l.pid DESC`
                  : sort === "price_desc"
                    ? Prisma.sql`l.price DESC, l.pid DESC`
                    : sort === "discount"
                      ? Prisma.sql`l.discount DESC NULLS LAST, l.pid DESC`
                      : sort === "new"
                        ? Prisma.sql`l.listed DESC, l.pid DESC`
                        : sort === "flash_ending"
                          ? Prisma.sql`l."flashEndsAt" ASC NULLS LAST, l.pid DESC`
                          : Prisma.sql`COALESCE(s.qty, 0) DESC, l.pid DESC`;
        const rows = await this.prisma.$queryRaw<
            { pid: bigint; total: number; change: Date | null }[]
        >`
            WITH l AS (
                SELECT sp."productId" AS pid,
                       MIN(CASE WHEN ${LIVE_FLASH} THEN LEAST(sp."flashPrice", sp."sellingPrice") ELSE sp."sellingPrice" END) AS price,
                       MAX(1 - (CASE WHEN ${LIVE_FLASH} THEN LEAST(sp."flashPrice", sp."sellingPrice") ELSE sp."sellingPrice" END)
                               / NULLIF(COALESCE(sp."currentMrp", v.mrp), 0)) AS discount,
                       SUM(GREATEST(sp."availableQty" - sp."reservedQty", 0)) AS stock,
                       BOOL_OR(${LIVE_FLASH}) AS flash,
                       MIN(CASE WHEN ${LIVE_FLASH} THEN sp."flashEndsAt" END) AS "flashEndsAt",
                       MIN(CASE WHEN sp."flashPrice" IS NOT NULL AND sp."flashStartsAt" > now() THEN sp."flashStartsAt" END) AS "flashStartsAt",
                       MIN(sp."createdAt") AS listed
                FROM "StoreProduct" sp
                JOIN "Product" p ON p.id = sp."productId"
                JOIN "ProductVariant" v ON v.id = sp."variantId"
                WHERE ${where}
                GROUP BY 1
            ),
            s AS (
                SELECT oi."productId" AS pid, SUM(oi.quantity) AS qty
                FROM "OrderItem" oi JOIN "Order" o ON o.id = oi."orderId"
                WHERE o."storeId" = ${storeId} AND o."placedAt" > now() - interval '30 days'
                  AND o.status NOT IN ('PENDING_PAYMENT', 'CANCELLED', 'REJECTED', 'FAILED')
                GROUP BY 1
            )
            SELECT l.pid, (COUNT(*) OVER ())::int AS total, LEAST(l."flashEndsAt", l."flashStartsAt") AS change
            FROM l LEFT JOIN s ON s.pid = l.pid
            ${having.length ? Prisma.sql`WHERE ${Prisma.join(having, " AND ")}` : Prisma.empty}
            ORDER BY ${order}
            LIMIT ${limit + 1} OFFSET ${offset}`;
        return { rows, total: rows[0]?.total ?? 0 };
    }

    private async productPage(
        storeId: bigint,
        lang: string,
        f: ProductFilter,
        limit: number,
        offset: number,
        scope?: Scope,
    ): Promise<SourcePage> {
        if (scope?.only && !scope.only.length)
            return { items: [], next: null, total: 0 };
        const { rows, total } = await this.productIds(
            storeId,
            f,
            limit,
            offset,
            scope,
        );
        const page = rows.slice(0, limit);
        const changes = page
            .map((r) => r.change?.toISOString())
            .filter((x): x is string => !!x)
            .sort();
        return {
            items: await this.productCards(
                storeId,
                lang,
                page.map((r) => r.pid),
            ),
            next: rows.length > limit ? encodeCursor(offset + limit) : null,
            total,
            validUntil: changes[0] ?? null,
        };
    }

    private earliestFlashChange(cards: Record<string, any>[]) {
        return (
            cards
                .flatMap((c) =>
                    (
                        c.variants as { flashSale: { endsAt: string } | null }[]
                    ).map((v) => v.flashSale?.endsAt),
                )
                .filter((x): x is string => !!x)
                .sort()[0] ?? null
        );
    }

    /** Product cards (same shape as the storefront list), in the given order. */
    async productCards(
        storeId: bigint,
        lang: string,
        productIds: bigint[],
    ): Promise<Record<string, any>[]> {
        if (!productIds.length) return [];
        const languages = [...new Set([lang, this.locale.defaultLanguage])];
        const listings = await this.prisma.storeProduct.findMany({
            where: {
                storeId,
                productId: { in: productIds },
                isActive: true,
                variant: { isActive: true, deletedAt: null },
            },
            orderBy: [{ productId: "asc" }, { variantId: "asc" }],
            include: {
                variant: {
                    include: {
                        optionValues: {
                            include: {
                                optionValue: { select: { label: true } },
                            },
                        },
                    },
                },
                product: {
                    include: {
                        translations: {
                            where: { lang: { in: languages } },
                            select: { lang: true, title: true },
                        },
                        thumbnail: {
                            select: {
                                key: true,
                                variants: true,
                                isPrivate: true,
                                status: true,
                            },
                        },
                        brand: { select: { name: true } },
                    },
                },
            },
        });
        const cards = new Map<string, Record<string, any>>();
        for (const l of listings) {
            const k = l.productId.toString();
            const t =
                l.product.translations.find((x) => x.lang === lang) ??
                l.product.translations[0];
            const card = cards.get(k) ?? {
                kind: "product",
                productId: k,
                slug: l.product.slug,
                title: t?.title ?? "",
                brand: l.product.brand
                    ? this.locale.pick(l.product.brand.name, lang)
                    : null,
                thumbnailUrl:
                    l.product.thumbnail &&
                    l.product.thumbnail.status === MediaStatus.READY
                        ? this.media.urlForVariant(l.product.thumbnail, "thumb")
                        : null,
                variants: [] as Record<string, unknown>[],
                action: { type: "open_product", slug: l.product.slug },
            };
            const mrp = num(l.currentMrp ?? l.variant.mrp);
            const flash = flashState(l);
            const price = Math.min(flash.price, mrp || flash.price);
            const sellable = l.availableQty - l.reservedQty;
            card.variants.push({
                variantId: l.variantId.toString(),
                label:
                    l.variant.optionValues
                        .map((o) => this.locale.pick(o.optionValue.label, lang))
                        .join(" / ") || null,
                unit: l.variant.unit,
                unitValue: l.variant.unitValue,
                price: this.currency.format(price),
                mrp: this.currency.format(mrp),
                discountPct: mrp > 0 ? Math.round((1 - price / mrp) * 100) : 0,
                availability:
                    sellable >= l.minOrderQty ? "AVAILABLE" : "OUT_OF_STOCK",
                maxOrderQty: flash.maxPerOrder ?? l.maxOrderQty,
                flashSale: flash.live
                    ? {
                          endsAt: flash.endsAt,
                          remaining: flash.remaining,
                          regularPrice: this.currency.format(
                              flash.regularPrice,
                          ),
                      }
                    : null,
            });
            cards.set(k, card);
        }
        return productIds
            .map((id) => cards.get(id.toString()))
            .filter((c): c is Record<string, any> => !!c)
            .map((c) => {
                const available = c.variants.filter(
                    (v: { availability: string }) =>
                        v.availability === "AVAILABLE",
                );
                return {
                    ...c,
                    availability: available.length
                        ? "AVAILABLE"
                        : "OUT_OF_STOCK",
                    // Variant the "ADD" button uses: cheapest available, else the first.
                    defaultVariantId: (
                        (available.length ? available : c.variants) as {
                            variantId: string;
                            price: { amount: number };
                        }[]
                    )
                        .slice()
                        .sort((a, b) => a.price.amount - b.price.amount)[0]
                        ?.variantId,
                };
            });
    }

    // ---------------------------------------------------------------------
    // Categories / brands (only those with live products in the store)
    // ---------------------------------------------------------------------

    /** Category ids with live products in the store, plus all their ancestors. */
    private liveCategoryIds(storeId: bigint) {
        return this.cache.cached(
            `sdui:livecats:${storeId}`,
            LIVE_TTL,
            async () => {
                const rows = await this.prisma.$queryRaw<{ id: bigint }[]>`
                    WITH RECURSIVE live AS (
                        SELECT DISTINCT p."categoryId" AS id
                        FROM "StoreProduct" sp JOIN "Product" p ON p.id = sp."productId" JOIN "ProductVariant" v ON v.id = sp."variantId"
                        WHERE sp."storeId" = ${storeId} AND ${LIVE_LISTING} AND p."categoryId" IS NOT NULL
                    ), up AS (
                        SELECT id FROM live
                        UNION
                        SELECT c."parentId" FROM "Category" c JOIN up ON c.id = up.id WHERE c."parentId" IS NOT NULL
                    )
                    SELECT id FROM up`;
                return rows.map((r) => r.id.toString());
            },
            { localMs: 5000 },
        );
    }

    /** Brand ids with live products in the store, most products first. */
    private liveBrandIds(storeId: bigint, categoryIds: bigint[] = []) {
        return this.cache.cached(
            `sdui:livebrands:${storeId}:${categoryIds.length ? checksum(categoryIds.map(String).sort()).slice(0, 12) : "all"}`,
            LIVE_TTL,
            async () => {
                const rows = await this.prisma.$queryRaw<{ id: bigint }[]>`
                    SELECT p."brandId" AS id
                    FROM "StoreProduct" sp JOIN "Product" p ON p.id = sp."productId" JOIN "ProductVariant" v ON v.id = sp."variantId"
                    WHERE sp."storeId" = ${storeId} AND ${LIVE_LISTING} AND p."brandId" IS NOT NULL
                      ${categoryIds.length ? Prisma.sql`AND p."categoryId" IN (${Prisma.join(categoryIds)})` : Prisma.empty}
                    GROUP BY 1 ORDER BY COUNT(DISTINCT p.id) DESC, 1`;
                return rows.map((r) => r.id.toString());
            },
            { localMs: 5000 },
        );
    }

    private mediaUrl(
        m: {
            key: string;
            variants: unknown;
            isPrivate: boolean;
            status: string;
        } | null,
        v: "thumb" | "master",
    ) {
        return m && m.status === MediaStatus.READY
            ? this.media.urlForVariant(m, v)
            : null;
    }

    private async categoryTiles(lang: string, catIds: bigint[]) {
        if (!catIds.length) return [];
        const rows = await this.prisma.category.findMany({
            where: { id: { in: catIds }, status: CategoryStatus.ACTIVE },
            select: {
                id: true,
                slug: true,
                name: true,
                icon: {
                    select: {
                        key: true,
                        variants: true,
                        isPrivate: true,
                        status: true,
                    },
                },
                banner: {
                    select: {
                        key: true,
                        variants: true,
                        isPrivate: true,
                        status: true,
                    },
                },
            },
        });
        const byId = new Map(rows.map((c) => [c.id, c]));
        return catIds
            .map((i) => byId.get(i))
            .filter((c): c is (typeof rows)[number] => !!c)
            .map((c) => ({
                kind: "category",
                categoryId: c.id.toString(),
                slug: c.slug,
                name: this.locale.pick(c.name, lang),
                iconUrl: this.mediaUrl(c.icon, "thumb"),
                imageUrl: this.mediaUrl(c.banner, "master"),
                action: { type: "open_category", categoryId: c.id.toString() },
            }));
    }

    private async brandTiles(lang: string, brandIds: bigint[]) {
        if (!brandIds.length) return [];
        const rows = await this.prisma.brand.findMany({
            where: { id: { in: brandIds }, status: BrandStatus.ACTIVE },
            select: {
                id: true,
                slug: true,
                name: true,
                logo: {
                    select: {
                        key: true,
                        variants: true,
                        isPrivate: true,
                        status: true,
                    },
                },
            },
        });
        const byId = new Map(rows.map((b) => [b.id, b]));
        return brandIds
            .map((i) => byId.get(i))
            .filter((b): b is (typeof rows)[number] => !!b)
            .map((b) => ({
                kind: "brand",
                brandId: b.id.toString(),
                slug: b.slug,
                name: this.locale.pick(b.name, lang),
                logoUrl: this.mediaUrl(b.logo, "thumb"),
                action: { type: "open_brand", brandId: b.id.toString() },
            }));
    }

    private async categoryPage(
        storeId: bigint,
        lang: string,
        only: bigint[],
        parent: string | undefined,
        limit: number,
        offset: number,
    ): Promise<SourcePage> {
        const live = new Set(await this.liveCategoryIds(storeId));
        if (!live.size) return { items: [], next: null };
        let ordered: bigint[];
        if (only.length) ordered = only.filter((i) => live.has(i.toString()));
        else {
            const rows = await this.prisma.category.findMany({
                where: {
                    id: { in: [...live].map(BigInt) },
                    status: CategoryStatus.ACTIVE,
                    ...(parent !== undefined && {
                        parentId: parent === "0" ? null : BigInt(parent),
                    }),
                },
                orderBy: [{ position: "asc" }, { id: "asc" }],
                select: { id: true },
            });
            ordered = rows.map((r) => r.id);
        }
        return {
            items: await this.categoryTiles(
                lang,
                ordered.slice(offset, offset + limit),
            ),
            next:
                ordered.length > offset + limit
                    ? encodeCursor(offset + limit)
                    : null,
            total: ordered.length,
        };
    }

    private async brandPage(
        storeId: bigint,
        lang: string,
        only: bigint[],
        categoryIds: string[] | undefined,
        limit: number,
        offset: number,
    ): Promise<SourcePage> {
        const cats = categoryIds?.length
            ? await this.browse.withDescendants(ids(categoryIds))
            : [];
        const live = await this.liveBrandIds(storeId, cats);
        const ordered = only.length
            ? only.map(String).filter((i) => live.includes(i))
            : live;
        return {
            items: await this.brandTiles(
                lang,
                ordered.slice(offset, offset + limit).map(BigInt),
            ),
            next:
                ordered.length > offset + limit
                    ? encodeCursor(offset + limit)
                    : null,
            total: ordered.length,
        };
    }
}
