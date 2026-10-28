import { PrismaService } from "@core/database/prisma.service";
import { MediaService } from "@modules/media/media.service";
import { Injectable } from "@nestjs/common";
import {
    BrandStatus,
    CategoryStatus,
    MediaStatus,
    MediaType,
    SduiGroupKind,
    SduiScreenKind,
    SduiVersionStatus,
} from "@prisma-client/enums";
import {
    I18nText,
    SduiLayout,
    SduiNode,
    SduiRule,
    Segment,
} from "../schema/contract";
import { starterLayout } from "../schema/starters";
import { checksum, SduiCache } from "../sdui.util";
import { GroupSchedule } from "./time-window";

export interface VersionRef {
    id: string;
    version: number;
    minAppVersion: string | null;
}
export interface RuleMeta extends Pick<
    SduiRule,
    "id" | "priority" | "startsAt" | "endsAt" | "conditions"
> {
    version: VersionRef;
}
export interface ScreenMeta {
    id: string;
    key: string;
    kind: SduiScreenKind;
    title: I18nText;
    live: VersionRef | null;
    /** Newest first (an old app falls back to the newest version it can draw). */
    published: VersionRef[];
    /** Active rules on published versions, in priority order. */
    rules: RuleMeta[];
}
export interface GroupConf {
    id: string;
    key: string;
    title: I18nText;
    subtitle: I18nText | null;
    media: Record<string, { mediaId: string }> | null;
    kind: SduiGroupKind;
    items: { type: "product" | "category" | "brand"; id: string }[];
    rule: Record<string, unknown> | null;
    schedule: GroupSchedule | null;
    landingScreenKey: string | null;
    landing: Record<string, any> | null;
    /** Changes whenever the group content changes (keys of its data caches). */
    rev: string;
}
export interface EntityConf {
    type: "category" | "brand";
    id: string;
    slug: string;
    name: I18nText;
    description: I18nText | null;
    /** Media ids (resolved with media()). */
    icon: string | null;
    banner: string | null;
    /** Category: active direct sub-categories (tabs). */
    children: {
        id: string;
        slug: string;
        name: I18nText;
        icon: string | null;
    }[];
}
export interface MediaOut {
    type: "image" | "video";
    url: string | null;
    thumbUrl: string | null;
    width: number | null;
    height: number | null;
    mimeType: string;
}

/** TTLs (seconds). Generation-keyed entries can live long: a change makes them unreachable at once. */
const CONFIG_TTL = 900;
const CONFIG_LOCAL_MS = 10_000;
const LAYOUT_TTL = 86_400;
const LAYOUT_LOCAL_MS = 10 * 60_000;
const ENTITY_TTL = 300;
const ENTITY_LOCAL_MS = 30_000;

/**
 * Everything admin-made the app renderer reads (screens, versions, rules, saved sections, custom groups,
 * media), cached in memory + Redis, keyed by the SDUI generation. Catalogue data the SDUI admin doesn't
 * own (category / brand names, store city) uses short plain TTLs instead.
 */
@Injectable()
export class SduiConfigService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly cache: SduiCache,
        private readonly mediaService: MediaService,
    ) {}

    /** Active screen with its live / published versions and rules (null = unknown or switched off). */
    async screen(key: string): Promise<ScreenMeta | null> {
        const gen = await this.cache.gen();
        return this.cache.cached(
            `sdui:${gen}:screen:${key}`,
            CONFIG_TTL,
            async () => {
                const s = await this.prisma.sduiScreen.findFirst({
                    where: { key, deletedAt: null, isActive: true },
                    select: {
                        id: true,
                        key: true,
                        kind: true,
                        title: true,
                        rules: true,
                        liveVersionId: true,
                    },
                });
                if (!s) return null;
                const published = await this.prisma.sduiScreenVersion.findMany({
                    where: {
                        screenId: s.id,
                        status: SduiVersionStatus.PUBLISHED,
                    },
                    orderBy: { version: "desc" },
                    take: 30,
                    select: { id: true, version: true, minAppVersion: true },
                });
                const ref = (v: {
                    id: bigint;
                    version: number;
                    minAppVersion: string | null;
                }): VersionRef => ({
                    id: v.id.toString(),
                    version: v.version,
                    minAppVersion: v.minAppVersion,
                });
                const byId = new Map(
                    published.map((v) => [v.id.toString(), ref(v)]),
                );
                const rules = ((s.rules ?? []) as unknown as SduiRule[]).filter(
                    (r) => r.isActive,
                );
                // Rules can point at versions older than the newest 30.
                const missing = rules
                    .map((r) => r.versionId)
                    .filter((id) => !byId.has(id));
                if (missing.length)
                    for (const v of await this.prisma.sduiScreenVersion.findMany(
                        {
                            where: {
                                id: { in: missing.map(BigInt) },
                                status: SduiVersionStatus.PUBLISHED,
                            },
                            select: {
                                id: true,
                                version: true,
                                minAppVersion: true,
                            },
                        },
                    ))
                        byId.set(v.id.toString(), ref(v));
                const live = s.liveVersionId
                    ? (byId.get(s.liveVersionId.toString()) ?? null)
                    : null;
                return {
                    id: s.id.toString(),
                    key: s.key,
                    kind: s.kind,
                    title: s.title as I18nText,
                    live,
                    published: published.map(ref),
                    rules: rules
                        .filter((r) => byId.has(r.versionId))
                        .sort(
                            (a, b) =>
                                a.priority - b.priority ||
                                a.id.localeCompare(b.id),
                        )
                        .map((r) => ({
                            id: r.id,
                            priority: r.priority,
                            startsAt: r.startsAt,
                            endsAt: r.endsAt,
                            conditions: r.conditions,
                            version: byId.get(r.versionId)!,
                        })),
                } satisfies ScreenMeta;
            },
            { localMs: CONFIG_LOCAL_MS },
        );
    }

    /** Published layouts never change: cached by version id (no generation), long in memory. */
    layout(versionId: string): Promise<SduiLayout> {
        return this.cache.cached(
            `sdui:layout:${versionId}`,
            LAYOUT_TTL,
            async () =>
                (
                    await this.prisma.sduiScreenVersion.findUniqueOrThrow({
                        where: { id: BigInt(versionId) },
                        select: { layout: true },
                    })
                ).layout as unknown as SduiLayout,
            { localMs: LAYOUT_LOCAL_MS },
        );
    }

    /** Live layout of a screen, or its starter design while it was never published (system templates / shell). */
    async liveLayout(
        key: string,
        kind: SduiScreenKind,
    ): Promise<{ layout: SduiLayout; version: number | null }> {
        const meta = await this.screen(key);
        if (meta?.live)
            return {
                layout: await this.layout(meta.live.id),
                version: meta.live.version,
            };
        return { layout: starterLayout(kind, key), version: null };
    }

    /** Active saved sections by key. */
    async sections(keys: string[]): Promise<Map<string, SduiNode>> {
        if (!keys.length) return new Map();
        const gen = await this.cache.gen();
        const rows = await Promise.all(
            [...new Set(keys)].map((key) =>
                this.cache.cached(
                    `sdui:${gen}:section:${key}`,
                    CONFIG_TTL,
                    async () => {
                        const s = await this.prisma.sduiSection.findFirst({
                            where: { key, isActive: true, deletedAt: null },
                            select: { node: true },
                        });
                        return s
                            ? ([key, s.node as unknown as SduiNode] as const)
                            : null;
                    },
                    { localMs: CONFIG_LOCAL_MS },
                ),
            ),
        );
        return new Map(
            rows.filter((r): r is readonly [string, SduiNode] => !!r),
        );
    }

    /** Active custom groups by key (schedule not applied here). */
    async groups(keys: string[]): Promise<Map<string, GroupConf>> {
        if (!keys.length) return new Map();
        const gen = await this.cache.gen();
        const rows = await Promise.all(
            [...new Set(keys)].map((key) =>
                this.cache.cached(
                    `sdui:${gen}:group:${key}`,
                    CONFIG_TTL,
                    async (): Promise<GroupConf | null> => {
                        const g = await this.prisma.sduiGroup.findFirst({
                            where: { key, isActive: true, deletedAt: null },
                            include: {
                                landingScreen: {
                                    select: {
                                        key: true,
                                        isActive: true,
                                        deletedAt: true,
                                    },
                                },
                            },
                        });
                        if (!g) return null;
                        const conf = {
                            id: g.id.toString(),
                            key: g.key,
                            title: g.title as I18nText,
                            subtitle: (g.subtitle as I18nText) ?? null,
                            media: (g.media as GroupConf["media"]) ?? null,
                            kind: g.kind,
                            items: (g.items as GroupConf["items"]) ?? [],
                            rule: (g.rule as Record<string, unknown>) ?? null,
                            schedule: (g.schedule as GroupSchedule) ?? null,
                            landingScreenKey:
                                g.landingScreen &&
                                g.landingScreen.isActive &&
                                !g.landingScreen.deletedAt
                                    ? g.landingScreen.key
                                    : null,
                            landing:
                                (g.landing as Record<string, unknown>) ?? null,
                        };
                        return {
                            ...conf,
                            rev: checksum([
                                conf.kind,
                                conf.items,
                                conf.rule,
                            ]).slice(0, 12),
                        };
                    },
                    { localMs: CONFIG_LOCAL_MS },
                ),
            ),
        );
        return new Map(
            rows.filter((g): g is GroupConf => !!g).map((g) => [g.key, g]),
        );
    }

    /** Public, READY media → URLs (missing / private / processing ones are left out). */
    async media(ids: string[]): Promise<Map<string, MediaOut>> {
        const uniq = [...new Set(ids)].filter((i) => /^[0-9]+$/.test(i)).sort();
        if (!uniq.length) return new Map();
        const gen = await this.cache.gen();
        const rows = await this.cache.cached(
            `sdui:${gen}:media:${checksum(uniq).slice(0, 20)}`,
            CONFIG_TTL,
            async () => {
                const files = await this.prisma.mediaFile.findMany({
                    where: {
                        id: { in: uniq.map(BigInt) },
                        status: MediaStatus.READY,
                        deletedAt: null,
                        isPrivate: false,
                    },
                    select: {
                        id: true,
                        type: true,
                        key: true,
                        variants: true,
                        isPrivate: true,
                        width: true,
                        height: true,
                        mimeType: true,
                    },
                });
                return files.map((m): [string, MediaOut] => [
                    m.id.toString(),
                    {
                        type: m.type === MediaType.VIDEO ? "video" : "image",
                        url: this.mediaService.urlForVariant(m, "master"),
                        thumbUrl:
                            m.type === MediaType.IMAGE
                                ? this.mediaService.urlForVariant(m, "thumb")
                                : null,
                        width: m.width,
                        height: m.height,
                        mimeType: m.mimeType,
                    },
                ]);
            },
            { localMs: CONFIG_LOCAL_MS },
        );
        return new Map(rows);
    }

    /** Category / brand shown on a landing page (null = unknown / inactive). */
    entity(type: "category" | "brand", id: string): Promise<EntityConf | null> {
        if (!/^[0-9]{1,19}$/.test(id)) return Promise.resolve(null);
        return this.cache.cached(
            `sdui:entity:${type}:${id}`,
            ENTITY_TTL,
            async (): Promise<EntityConf | null> => {
                if (type === "brand") {
                    const b = await this.prisma.brand.findFirst({
                        where: { id: BigInt(id), status: BrandStatus.ACTIVE },
                    });
                    return b
                        ? {
                              type,
                              id,
                              slug: b.slug,
                              name: b.name as I18nText,
                              description: (b.description as I18nText) ?? null,
                              icon: b.logoId?.toString() ?? null,
                              banner: b.bannerId?.toString() ?? null,
                              children: [],
                          }
                        : null;
                }
                const c = await this.prisma.category.findFirst({
                    where: { id: BigInt(id), status: CategoryStatus.ACTIVE },
                    include: {
                        children: {
                            where: { status: CategoryStatus.ACTIVE },
                            orderBy: [{ position: "asc" }, { id: "asc" }],
                            select: {
                                id: true,
                                slug: true,
                                name: true,
                                iconId: true,
                            },
                        },
                    },
                });
                return c
                    ? {
                          type,
                          id,
                          slug: c.slug,
                          name: c.name as I18nText,
                          description: (c.description as I18nText) ?? null,
                          icon: c.iconId?.toString() ?? null,
                          banner: c.bannerId?.toString() ?? null,
                          children: c.children.map((x) => ({
                              id: x.id.toString(),
                              slug: x.slug,
                              name: x.name as I18nText,
                              icon: x.iconId?.toString() ?? null,
                          })),
                      }
                    : null;
            },
            { localMs: ENTITY_LOCAL_MS },
        );
    }

    storeCity(storeId: bigint): Promise<string | null> {
        return this.cache.cached(
            `sdui:storecity:${storeId}`,
            3600,
            async () =>
                (
                    await this.prisma.store.findUnique({
                        where: { id: storeId },
                        select: { city: true },
                    })
                )?.city ?? null,
            { localMs: 60_000 },
        );
    }

    /** GUEST / NEW_CUSTOMER / REPEAT_CUSTOMER (cached 10 min per user). */
    async segment(userId: bigint | null): Promise<Segment> {
        if (!userId) return "GUEST";
        const delivered = await this.cache.cached(
            `sdui:seg:${userId}`,
            600,
            () =>
                this.prisma.order.count({
                    where: { userId, status: "DELIVERED" },
                }),
            { localMs: 30_000 },
        );
        return delivered > 0 ? "REPEAT_CUSTOMER" : "NEW_CUSTOMER";
    }
}
