import { LocaleService } from "@core/locale/locale.service";
import { RedisService } from "@core/redis/redis.service";
import {
    GroupConf,
    MediaOut,
    ScreenMeta,
    SduiConfigService,
    VersionRef,
} from "./config.service";
import {
    DataSourcesService,
    ResolvedEntity,
} from "./data-sources.service";
import {
    EntityQuery,
    EntityRef,
    RenderContext,
    SourcePage,
} from "./render.types";
import {
    Boundary,
    inDaily,
    inRange,
    nextOpensAt,
    windowEndsAt,
} from "./time-window";
import {
    COMPONENT_MAP,
    ComponentDef,
} from "../schema/component.registry";
import {
    SDUI_SCHEMA_VERSION,
    SduiLayout,
    SduiNode,
    SduiVisibility,
    Segment,
} from "../schema/contract";
import {
    ACTION_REF,
    ACTIONS,
    DEFAULT_THEME,
    HEADER_SCHEMA,
    JsonSchema,
    PRODUCT_SORTS,
    STYLE_SCHEMA,
} from "../schema/definitions";
import { starterLayout } from "../schema/starters";
import { checksum, plain, SduiCache, SduiErrors } from "../sdui.util";
import { Injectable, NotFoundException } from "@nestjs/common";
import { SduiScreenKind } from "@prisma-client/enums";
import { createHash, randomBytes } from "crypto";
import { I18nService } from "nestjs-i18n";
import {
    compareVersions,
    LayoutValidatorService,
    walkSchema,
} from "../layout-validator.service";

/** What the controllers send: the body plus its HTTP cache data. */
export interface Rendered {
    body: Record<string, unknown>;
    /** Strong ETag of the content (same content → same ETag on every instance). */
    etag: string;
    /** How long the app may reuse it without asking (also Cache-Control max-age). */
    ttlSec: number;
}

type Node = SduiNode & { _outer?: SduiVisibility };
interface Job {
    ctx: RenderContext;
    segment: Segment;
    now: Date;
    boundary: Boundary;
    groups: Map<string, GroupConf>;
    media: Map<string, MediaOut>;
    /** Where lazy sections load from. */
    dataUrl: (nodeId: string) => string;
    entity?: ResolvedEntity;
    entityUrl?: string;
    query?: EntityQuery;
    /** First page of the entity products (shared by the header count and the grid). */
    entityPage?: Promise<SourcePage>;
    eagerLeft: number;
}

/** Screen responses are reused at most this long (then rebuilt from the cached data pages). */
const RESPONSE_TTL = 20;
const SHELL_TTL = 300;
/** Sections filled in the screen response; the rest come lazily (keeps the first paint fast). */
const EAGER_SECTIONS = 6;
const PREVIEW_TTL = 1800;
const NODE_SCHEMAS = {
    header: HEADER_SCHEMA,
    style: STYLE_SCHEMA,
    action: ACTION_REF,
} as const;
const TEMPLATE_OF = {
    group: "group_landing",
    category: "category_landing",
    brand: "brand_landing",
} as const;
const FILTERS_DEFAULT = ["category", "brand", "price"];
const ACTION_DEFS = new Map(ACTIONS.map((a) => [a.type, a.schema]));

/**
 * Turns a published (or previewed) layout into what the Flutter app draws:
 * 1. pick the version (first matching targeting rule → live → newest one this app version can draw),
 * 2. expand saved sections, 3. drop what is hidden for this user / platform / app version / time / schedule,
 * 4. fill the first sections with store data (the rest lazily), 5. localise texts and resolve media.
 *
 * Caching: the whole response is cached per (generation, version, store, language, platform, app version,
 * segment[, opened item + filters]) until the next time-based change (visibility window, group schedule,
 * flash sale start / end) or RESPONSE_TTL. Personal sections (buy again) are always lazy, so one cached
 * response serves every customer of a store and segment.
 */
@Injectable()
export class RenderService {
    constructor(
        private readonly config: SduiConfigService,
        private readonly sources: DataSourcesService,
        private readonly cache: SduiCache,
        private readonly redis: RedisService,
        private readonly locale: LocaleService,
        private readonly i18n: I18nService,
        private readonly validator: LayoutValidatorService,
        private readonly err: SduiErrors,
    ) {}

    // ---------------------------------------------------------------------
    // Public: app
    // ---------------------------------------------------------------------

    /** Bottom tabs, global app bar, theme and settings (SHELL). */
    async shell(ctx: RenderContext): Promise<Rendered> {
        const gen = await this.cache.gen();
        const { layout, version } = await this.config.liveLayout(
            "shell",
            SduiScreenKind.SHELL,
        );
        const key = `sdui:${gen}:out:shell:${version ?? 0}:${ctx.lang}:${ctx.platform}:${ctx.appVersion}`;
        return this.cache.cachedTtl(
            key,
            async () => {
                const job = await this.job(ctx, layout, {
                    dataUrl: (id) => `app/screens/shell/sections/${id}`,
                });
                const [appBar, bottomBar] = await Promise.all([
                    this.slot(layout.appBar, job),
                    this.slot(layout.bottomBar, job),
                ]);
                const body = {
                    schemaVersion: SDUI_SCHEMA_VERSION,
                    version,
                    theme: layout.theme ?? DEFAULT_THEME,
                    ...(appBar && { appBar }),
                    ...(bottomBar && { bottomBar }),
                    ...(layout.settings && { settings: layout.settings }),
                };
                return this.finish(body, Math.min(SHELL_TTL, job.boundary.sec));
            },
            { localMs: 2000 },
        );
    }

    /** A SCREEN / PAGE (home, categories tab, campaign page). `pinned` = keep showing that version (paging). */
    async screen(
        key: string,
        ctx: RenderContext,
        pinned?: number,
    ): Promise<Rendered> {
        const meta = await this.config.screen(key);
        if (
            !meta ||
            (meta.kind !== SduiScreenKind.SCREEN &&
                meta.kind !== SduiScreenKind.PAGE)
        )
            this.err.notFound("screen");
        const chosen = await this.choose(meta, ctx, pinned);
        if (!chosen) return this.updateRequired(meta);
        const gen = await this.cache.gen();
        const segment = await this.segmentOf(ctx);
        const cacheKey = `sdui:${gen}:out:s:${chosen.version.id}:${ctx.storeId ?? 0}:${ctx.lang}:${ctx.platform}:${ctx.appVersion}:${segment}`;
        return this.cache.cachedTtl(
            cacheKey,
            async () => {
                const layout = await this.config.layout(chosen.version.id);
                const v = chosen.version.version;
                return this.page(layout, ctx, segment, {
                    key,
                    kind: meta.kind,
                    title: meta.title,
                    version: v,
                    variant: chosen.ruleId,
                    dataUrl: (id) =>
                        `app/screens/${encodeURIComponent(key)}/sections/${encodeURIComponent(id)}?v=${v}`,
                });
            },
            { localMs: 1000 },
        );
    }

    /**
     * What opens when a custom group / category / brand is tapped: its landing TEMPLATE (the group's own
     * landing screen, else group_landing / category_landing / brand_landing), rendered for that item.
     */
    async landing(
        ref: EntityRef,
        ctx: RenderContext,
        query: EntityQuery = {},
    ): Promise<Rendered> {
        const entity = await this.entity(ref, ctx);
        const templateKey =
            (entity.type === "group" && entity.group.landingScreenKey) ||
            TEMPLATE_OF[ref.type];
        let meta = await this.config.screen(templateKey);
        if (!meta && templateKey !== TEMPLATE_OF[ref.type])
            meta = await this.config.screen(TEMPLATE_OF[ref.type]);
        const chosen = meta ? await this.choose(meta, ctx) : null;
        const key = meta?.key ?? TEMPLATE_OF[ref.type];
        const kind = meta?.kind ?? SduiScreenKind.TEMPLATE;
        const gen = await this.cache.gen();
        const segment = await this.segmentOf(ctx);
        const q = this.cleanQuery(query);
        const entityKey =
            entity.type === "group"
                ? `g:${entity.group.key}`
                : `${ref.type[0]}:${entity.entity.id}`;
        const cacheKey = `sdui:${gen}:out:l:${chosen?.version.id ?? `starter-${key}`}:${entityKey}:${checksum(q).slice(0, 10)}:${ctx.storeId ?? 0}:${ctx.lang}:${ctx.platform}:${ctx.appVersion}:${segment}`;
        return this.cache.cachedTtl(
            cacheKey,
            async () => {
                const layout = chosen
                    ? await this.config.layout(chosen.version.id)
                    : starterLayout(SduiScreenKind.TEMPLATE, key);
                const v = chosen?.version.version ?? null;
                const title =
                    entity.type === "group"
                        ? entity.group.title
                        : entity.entity.name;
                return this.page(layout, ctx, segment, {
                    key,
                    kind,
                    title,
                    version: v,
                    variant: chosen?.ruleId ?? null,
                    dataUrl: (id) =>
                        `app/screens/${encodeURIComponent(key)}/sections/${encodeURIComponent(id)}${v ? `?v=${v}` : ""}`,
                    entity,
                    entityUrl: `app/landing/${ref.type}/${encodeURIComponent(ref.ref)}/items`,
                    query: q,
                });
            },
            { localMs: 1000 },
        );
    }

    /** More products of a landing page (filters / sort / next page). */
    async landingItems(
        ref: EntityRef,
        ctx: RenderContext,
        query: EntityQuery,
        cursor?: string | null,
        limit = 20,
    ) {
        const entity = await this.entity(ref, ctx);
        const q = this.cleanQuery(query);
        const page = await this.sources.resolve(
            { type: "entity", limit },
            ctx,
            { cursor, entity, query: q },
        );
        const url = `app/landing/${ref.type}/${encodeURIComponent(ref.ref)}/items`;
        return this.pageOut(
            ref.ref,
            page,
            page.next ? `${url}?${this.qs({ ...q, cursor: page.next })}` : null,
        );
    }

    /** One section's data (lazy sections and "load more"). */
    async section(
        key: string,
        nodeId: string,
        ctx: RenderContext,
        opts: { version?: number; cursor?: string | null } = {},
    ) {
        const meta = await this.config.screen(key);
        let layout: SduiLayout;
        let version: number | null = null;
        if (meta) {
            const chosen = await this.choose(meta, ctx, opts.version);
            if (!chosen) this.err.notFound("screen");
            layout = await this.config.layout(chosen.version.id);
            version = chosen.version.version;
        } else if (Object.values(TEMPLATE_OF).includes(key as never))
            layout = starterLayout(SduiScreenKind.TEMPLATE, key);
        else this.err.notFound("screen");
        return this.sectionData(
            layout,
            key,
            nodeId,
            ctx,
            opts.cursor,
            `app/screens/${encodeURIComponent(key)}/sections/${encodeURIComponent(nodeId)}?${version ? `v=${version}&` : ""}`,
        );
    }

    // ---------------------------------------------------------------------
    // Public: admin preview
    // ---------------------------------------------------------------------

    /**
     * Renders a draft (or any layout) like the app would, never cached. Returns a token a phone can open
     * (GET app/preview/{token}) for 30 minutes.
     */
    async preview(
        screen: { key: string; kind: SduiScreenKind },
        layout: unknown,
        ctx: RenderContext,
        opts: { entity?: EntityRef; query?: EntityQuery } = {},
    ) {
        const structure = this.validator.validateStructure(layout, screen.kind);
        const token = randomBytes(18).toString("base64url");
        const body = await this.previewBody(screen, layout as SduiLayout, ctx, {
            ...opts,
            token,
        });
        await this.redis.setJson(
            `sdui:preview:${token}`,
            plain({
                screen,
                layout,
                entity: opts.entity,
                query: opts.query,
                ctx: {
                    storeId: ctx.storeId,
                    userId: ctx.userId,
                    segments: ctx.segments,
                    now: ctx.now,
                },
            }),
            PREVIEW_TTL,
        );
        return {
            token,
            expiresAt: new Date(Date.now() + PREVIEW_TTL * 1000),
            /** Open on a phone (QR code). */
            appPath: `app/preview/${token}`,
            issues: { errors: structure.errors, warnings: structure.warnings },
            rendered: body,
        };
    }

    /** Device side of a preview token (store / user / time from the token; platform / version / language from the device). */
    async previewByToken(
        token: string,
        device: RenderContext,
        nodeId?: string,
        cursor?: string | null,
    ) {
        const p = await this.redis.getJson<{
            screen: { key: string; kind: SduiScreenKind };
            layout: SduiLayout;
            entity?: EntityRef;
            query?: EntityQuery;
            ctx: {
                storeId?: string | null;
                userId?: string | null;
                segments?: Segment[];
                now?: string;
            };
        }>(`sdui:preview:${token}`);
        if (!p)
            throw new NotFoundException({
                message: this.err.t("errors.previewNotFound"),
                code: "PREVIEW_NOT_FOUND",
            });
        const ctx: RenderContext = {
            ...device,
            storeId: p.ctx.storeId ? BigInt(p.ctx.storeId) : null,
            userId: p.ctx.userId ? BigInt(p.ctx.userId) : null,
            segments: p.ctx.segments,
            ...(p.ctx.now && { now: new Date(p.ctx.now) }),
        };
        if (nodeId)
            return this.sectionData(
                p.layout,
                p.screen.key,
                nodeId,
                ctx,
                cursor,
                `app/preview/${token}/sections/${encodeURIComponent(nodeId)}?`,
            );
        return this.previewBody(p.screen, p.layout, ctx, {
            entity: p.entity,
            query: p.query,
            token,
        });
    }

    /** Designer "test this source": what it returns for a store right now. */
    async dataPreview(
        source: Record<string, unknown>,
        ctx: RenderContext,
        opts: { entity?: EntityRef; cursor?: string | null } = {},
    ) {
        const issues = this.validator.sourceIssues(source);
        if (issues.length) this.err.invalid(issues);
        const s = source as Record<string, unknown> & { type: string };
        const groups = await this.config.groups(
            s.type === "group"
                ? [String(s.key)]
                : s.type === "groups"
                  ? ((s.keys as string[]) ?? [])
                  : [],
        );
        const entity = opts.entity
            ? await this.entity(opts.entity, ctx)
            : undefined;
        return plain(
            await this.sources.resolve(s, ctx, {
                cursor: opts.cursor,
                groups,
                entity,
            }),
        );
    }

    // ---------------------------------------------------------------------
    // Version choice & targeting
    // ---------------------------------------------------------------------

    private canDraw = (
        minAppVersion: string | null | undefined,
        ctx: RenderContext,
    ) => !minAppVersion || compareVersions(ctx.appVersion, minAppVersion) >= 0;

    private async choose(
        meta: ScreenMeta,
        ctx: RenderContext,
        pinned?: number,
    ): Promise<{ version: VersionRef; ruleId: string | null } | null> {
        if (pinned !== undefined) {
            const v =
                meta.published.find((p) => p.version === pinned) ??
                meta.rules.find((r) => r.version.version === pinned)?.version;
            if (v && this.canDraw(v.minAppVersion, ctx))
                return { version: v, ruleId: null };
        }
        const now = ctx.now ?? new Date();
        for (const r of meta.rules) {
            if (!inRange(r.startsAt, r.endsAt, now)) continue;
            if (!this.canDraw(r.version.minAppVersion, ctx)) continue;
            if (
                !(await this.matches(
                    r.conditions as Record<string, any>,
                    ctx,
                    meta.key,
                ))
            )
                continue;
            return { version: r.version, ruleId: r.id };
        }
        if (meta.live && this.canDraw(meta.live.minAppVersion, ctx))
            return { version: meta.live, ruleId: null };
        // Old app: newest published version it can draw.
        const fallback = meta.published.find((p) =>
            this.canDraw(p.minAppVersion, ctx),
        );
        return fallback ? { version: fallback, ruleId: null } : null;
    }

    private async segmentOf(ctx: RenderContext): Promise<Segment> {
        return ctx.segments?.[0] ?? this.config.segment(ctx.userId);
    }

    /** Stable 0–99 bucket per user (or install) and salt. */
    private bucket(ctx: RenderContext, salt: string) {
        const who = ctx.userId?.toString() ?? ctx.deviceId ?? "anon";
        return (
            parseInt(
                createHash("sha1")
                    .update(`${salt}:${who}`)
                    .digest("hex")
                    .slice(0, 8),
                16,
            ) % 100
        );
    }

    private async matches(
        c: Record<string, any>,
        ctx: RenderContext,
        screenKey: string,
    ): Promise<boolean> {
        if (
            c.storeIds?.length &&
            !(ctx.storeId && c.storeIds.includes(ctx.storeId.toString()))
        )
            return false;
        if (c.cities?.length) {
            if (ctx.city === undefined)
                ctx.city = ctx.storeId
                    ? await this.config.storeCity(ctx.storeId)
                    : null;
            if (
                !ctx.city ||
                !c.cities.some(
                    (x: string) => x.toLowerCase() === ctx.city!.toLowerCase(),
                )
            )
                return false;
        }
        if (c.platforms?.length && !c.platforms.includes(ctx.platform))
            return false;
        if (
            c.appVersion?.min &&
            compareVersions(ctx.appVersion, c.appVersion.min) < 0
        )
            return false;
        if (
            c.appVersion?.max &&
            compareVersions(ctx.appVersion, c.appVersion.max) > 0
        )
            return false;
        if (c.loggedIn !== undefined && c.loggedIn !== !!ctx.userId)
            return false;
        if (
            c.segments?.length &&
            !c.segments.includes(await this.segmentOf(ctx))
        )
            return false;
        if (c.abBucket) {
            const b = this.bucket(ctx, c.abBucket.salt ?? screenKey);
            if (b < c.abBucket.from || b > c.abBucket.to) return false;
        }
        return true;
    }

    /** Section visibility; records when the answer changes next. */
    private visible(v: SduiVisibility | undefined, job: Job) {
        if (!v) return true;
        const { ctx, now, boundary } = job;
        if (!inRange(v.from, v.to, now, boundary)) return false;
        if (v.daily && !inDaily(v.daily, now, this.sources.timezone, boundary))
            return false;
        if (v.platforms?.length && !v.platforms.includes(ctx.platform))
            return false;
        if (
            v.appVersion?.min &&
            compareVersions(ctx.appVersion, v.appVersion.min) < 0
        )
            return false;
        if (
            v.appVersion?.max &&
            compareVersions(ctx.appVersion, v.appVersion.max) > 0
        )
            return false;
        if (
            v.loggedIn !== undefined &&
            v.loggedIn !== (job.segment !== "GUEST")
        )
            return false;
        if (
            v.storeIds?.length &&
            !(ctx.storeId && v.storeIds.includes(ctx.storeId.toString()))
        )
            return false;
        if (v.segments?.length && !v.segments.includes(job.segment))
            return false;
        return true;
    }

    private groupOn(key: unknown, job: Job) {
        const g = job.groups.get(String(key));
        return !!g && this.sources.groupOn(g, job.now, job.boundary);
    }

    // ---------------------------------------------------------------------
    // Entities (landing pages)
    // ---------------------------------------------------------------------

    private async entity(
        ref: EntityRef,
        ctx: RenderContext,
    ): Promise<ResolvedEntity> {
        if (ref.type === "group") {
            const g = (await this.config.groups([ref.ref])).get(ref.ref);
            if (!g) this.err.notFound("group");
            const now = ctx.now ?? new Date();
            if (!this.sources.groupOn(g, now))
                throw new NotFoundException({
                    message: this.err.t("errors.groupOff"),
                    code: "GROUP_NOT_AVAILABLE",
                    opensAt: nextOpensAt(
                        g.schedule,
                        now,
                        this.sources.timezone,
                    ),
                });
            return { type: "group", group: g };
        }
        const e = await this.config.entity(ref.type, ref.ref);
        if (!e)
            throw new NotFoundException({
                message: this.err.t(`errors.${ref.type}NotFound`),
                code: `${ref.type.toUpperCase()}_NOT_FOUND`,
            });
        return { type: ref.type, entity: e };
    }

    private cleanQuery(q: EntityQuery): EntityQuery {
        const out: EntityQuery = {};
        if (q.sort && (PRODUCT_SORTS as readonly string[]).includes(q.sort))
            out.sort = q.sort;
        if (q.categoryId && /^[0-9]{1,19}$/.test(q.categoryId))
            out.categoryId = q.categoryId;
        if (q.brandId && /^[0-9]{1,19}$/.test(q.brandId))
            out.brandId = q.brandId;
        for (const k of ["minPrice", "maxPrice", "minDiscountPct"] as const)
            if (q[k] !== undefined && Number.isFinite(Number(q[k])))
                out[k] = Number(q[k]);
        return out;
    }

    private qs(q: Record<string, unknown>) {
        return Object.entries(q)
            .filter(([, v]) => v !== undefined && v !== null && v !== "")
            .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
            .join("&");
    }

    // ---------------------------------------------------------------------
    // Layout → response
    // ---------------------------------------------------------------------

    /** Replace section_ref nodes with the saved section (inactive / missing ones disappear). */
    private async expand(layout: SduiLayout): Promise<SduiLayout> {
        const refs = (layout.sections ?? [])
            .filter((n) => n?.type === "section_ref" && n.ref)
            .map((n) => n.ref!);
        if (!refs.length) return layout;
        const lib = await this.config.sections(refs);
        const prefix = (n: SduiNode, p: string): SduiNode => ({
            ...n,
            id: `${p}__${n.id}`,
            children: n.children?.map((c) => prefix(c, p)),
        });
        return {
            ...layout,
            sections: layout.sections.flatMap((n) => {
                if (n?.type !== "section_ref") return [n];
                const node = lib.get(n.ref!);
                if (!node) return [];
                // The placement keeps its own id (analytics / lazy loading) and adds its own visibility.
                return [
                    {
                        ...node,
                        id: n.id,
                        children: node.children?.map((c) => prefix(c, n.id)),
                        _outer: n.visibility,
                    } as Node,
                ];
            }),
        };
    }

    private nodesOf(layout: SduiLayout) {
        const all: SduiNode[] = [];
        const visit = (n?: SduiNode) => {
            if (!n) return;
            all.push(n);
            n.children?.forEach(visit);
        };
        visit(layout.appBar);
        visit(layout.bottomBar);
        layout.sections?.forEach(visit);
        return all;
    }

    /** Everything a render needs loaded up front: groups and media of all nodes (+ the opened item). */
    private async job(
        ctx: RenderContext,
        layout: SduiLayout,
        extra: Pick<Job, "dataUrl"> & Partial<Job>,
        segment?: Segment,
    ): Promise<Job> {
        const nodes = this.nodesOf(layout);
        const groupKeys = nodes.flatMap((n) =>
            n.source?.type === "group"
                ? [String(n.source.key)]
                : n.source?.type === "groups"
                  ? ((n.source.keys as string[]) ?? [])
                  : [],
        );
        const groups = await this.config.groups(groupKeys);
        if (extra.entity?.type === "group")
            groups.set(extra.entity.group.key, extra.entity.group);
        const mediaIds: string[] = [];
        for (const n of nodes) {
            const def = COMPONENT_MAP.get(n.type);
            if (!def) continue;
            const collect = (value: unknown, schema: JsonSchema | undefined) =>
                walkSchema(
                    value,
                    schema,
                    "",
                    (kind, v) =>
                        kind === "media" &&
                        v?.mediaId &&
                        mediaIds.push(String(v.mediaId)),
                );
            collect(n.header, HEADER_SCHEMA);
            collect(n.style, STYLE_SCHEMA);
            collect(n.props, def.propsSchema);
            if (def.items)
                collect(n.items, { type: "array", items: def.items.schema });
        }
        const e = extra.entity;
        if (e?.type === "group")
            mediaIds.push(
                ...Object.values(e.group.media ?? {}).map((m) => m.mediaId),
            );
        else if (e)
            mediaIds.push(
                ...[
                    e.entity.icon,
                    e.entity.banner,
                    ...e.entity.children.map((c) => c.icon),
                ].filter((x): x is string => !!x),
            );
        return {
            ctx,
            segment: segment ?? (await this.segmentOf(ctx)),
            now: ctx.now ?? new Date(),
            boundary: new Boundary(),
            groups,
            media: await this.config.media(mediaIds),
            eagerLeft: EAGER_SECTIONS,
            ...extra,
        };
    }

    /** Localise texts, resolve media, recurse into actions. Static items whose image is gone are dropped. */
    private localize(
        value: unknown,
        schema: JsonSchema | undefined,
        job: Job,
    ): unknown {
        if (value === null || value === undefined || !schema) return value;
        if (schema.$ref === "sdui://action") {
            const t = (value as { type?: string }).type;
            const def = ACTION_DEFS.get(String(t));
            return def ? this.localize(value, def, job) : value;
        }
        if (schema["x-localized"])
            return this.locale.pick(value, job.ctx.lang) || null;
        if (schema["x-media"])
            return (
                job.media.get(
                    String((value as { mediaId?: string }).mediaId),
                ) ?? null
            );
        if (Array.isArray(value)) {
            const itemSchema = schema.items as JsonSchema | undefined;
            const imageRequired = (
                (itemSchema?.required as string[] | undefined) ?? []
            ).includes("image");
            return value
                .map((v) => this.localize(v, itemSchema, job))
                .filter(
                    (v) =>
                        !(
                            imageRequired &&
                            !(v as Record<string, unknown>)?.image
                        ),
                );
        }
        if (typeof value === "object") {
            const props = schema.properties as
                | Record<string, JsonSchema>
                | undefined;
            const extraSchema =
                typeof schema.additionalProperties === "object"
                    ? (schema.additionalProperties as JsonSchema)
                    : undefined;
            return Object.fromEntries(
                Object.entries(value as Record<string, unknown>).map(
                    ([k, v]) => [
                        k,
                        this.localize(v, props?.[k] ?? extraSchema, job),
                    ],
                ),
            );
        }
        return value;
    }

    private variantOf(n: SduiNode, def: ComponentDef, job: Job) {
        const v =
            def.variants.find((x) => x.key === n.variant) ?? def.variants[0];
        // A design newer than the app falls back to the default design instead of hiding the section.
        return v && this.canDraw(v.minAppVersion, job.ctx)
            ? v.key
            : def.variants[0]?.key;
    }

    private async present(
        n: Node,
        job: Job,
    ): Promise<Record<string, unknown> | null> {
        const def = COMPONENT_MAP.get(n?.type);
        if (!def || def.type === "section_ref") return null; // unknown / unresolved: never sent
        if (!this.canDraw(def.minAppVersion, job.ctx)) return null;
        if (!this.visible(n._outer, job) || !this.visible(n.visibility, job))
            return null;
        if (n.source?.type === "group" && !this.groupOn(n.source.key, job))
            return null;

        const out: Record<string, unknown> = {
            id: n.id,
            type: n.type,
            variant: this.variantOf(n, def, job),
        };
        for (const k of ["header", "style", "action"] as const)
            if (n[k] !== undefined)
                out[k] = this.localize(n[k], NODE_SCHEMAS[k], job);
        if (n.layout) out.layout = { ...n.layout };
        if (n.props) out.props = this.localize(n.props, def.propsSchema, job);
        if (n.items && def.items) {
            const items = this.localize(
                n.items,
                { type: "array", items: def.items.schema },
                job,
            ) as unknown[];
            if (!items.length && def.items.min > 0) return null;
            out.items = items;
        }
        if (n.lazy) out.lazy = true;

        if (job.entity && (await this.entityBlock(n, def, out, job)) === false)
            return null;

        if (n.source && n.source.type !== "entity") {
            // Personal data never goes into the shared (cached) response.
            const personal = n.source.type === "reorder";
            if (!n.lazy && !personal && job.eagerLeft > 0) {
                job.eagerLeft--;
                const page = await this.sources.resolve(n.source, job.ctx, {
                    groups: job.groups,
                });
                job.boundary.at(page.validUntil, job.now);
                if (!page.items.length && def.sourceRequired) return null; // empty rails are dropped, not drawn
                const url = job.dataUrl(n.id);
                out.data = {
                    items: page.items,
                    next: page.next
                        ? `${url}${url.includes("?") ? "&" : "?"}cursor=${page.next}`
                        : null,
                    ...(page.total !== undefined && { total: page.total }),
                    ...(page.meta && { meta: page.meta }),
                };
            } else {
                out.lazy = true;
                out.dataUrl = job.dataUrl(n.id);
            }
        }

        if (n.children) {
            const kids: Record<string, unknown>[] = [];
            for (const c of n.children) {
                const k = await this.present(c, job);
                if (k) kids.push(k);
            }
            if (def.type === "container" && !kids.length) return null;
            out.children = kids;
        }
        return out;
    }

    /** Landing templates: fill the header / tabs / filters / product grid from the opened item. */
    private async entityBlock(
        n: Node,
        def: ComponentDef,
        out: Record<string, unknown>,
        job: Job,
    ): Promise<boolean | void> {
        const e = job.entity!;
        const lang = job.ctx.lang;
        const landing = e.type === "group" ? (e.group.landing ?? {}) : {};
        const firstPage = () =>
            (job.entityPage ??= this.sources.resolve(
                { type: "entity", limit: 20 },
                job.ctx,
                { entity: e, query: job.query },
            ));

        if (def.type === "entity_header") {
            if (
                landing.header &&
                def.variants.some((v) => v.key === landing.header)
            )
                out.variant = landing.header;
            const media = (id?: string | null) =>
                id ? (job.media.get(id) ?? null) : null;
            const total = (await firstPage()).total ?? 0;
            out.data =
                e.type === "group"
                    ? {
                          kind: "group",
                          key: e.group.key,
                          title: this.locale.pick(e.group.title, lang),
                          subtitle: e.group.subtitle
                              ? this.locale.pick(e.group.subtitle, lang)
                              : null,
                          image: media(
                              e.group.media?.banner?.mediaId ??
                                  e.group.media?.cover?.mediaId,
                          ),
                          icon: media(e.group.media?.icon?.mediaId),
                          background: landing.background ?? null,
                          itemCount: total,
                          endsAt: windowEndsAt(
                              e.group.schedule,
                              job.now,
                              this.sources.timezone,
                          ),
                      }
                    : {
                          kind: e.type,
                          id: e.entity.id,
                          slug: e.entity.slug,
                          title: this.locale.pick(e.entity.name, lang),
                          subtitle: e.entity.description
                              ? this.locale.pick(e.entity.description, lang)
                              : null,
                          image: media(e.entity.banner),
                          icon: media(e.entity.icon),
                          itemCount: total,
                          endsAt: null,
                      };
            return;
        }
        if (def.type === "subcategory_tabs") {
            let tabs: { id: string; name: string; icon?: MediaOut | null }[];
            if (e.type === "category")
                tabs = e.entity.children.map((c) => ({
                    id: c.id,
                    name: this.locale.pick(c.name, lang),
                    icon: c.icon ? (job.media.get(c.icon) ?? null) : null,
                }));
            else
                tabs = (await this.sources.facets(e, job.ctx)).categories.map(
                    (c) => ({ id: c.id, name: c.name }),
                );
            if (!tabs.length) return false;
            out.data = {
                all: this.label("filters.all", lang),
                items: tabs,
                selected: job.query?.categoryId ?? null,
                param: "categoryId",
                itemsUrl: job.entityUrl,
            };
            return;
        }
        if (def.type === "filter_bar") {
            const facets = await this.sources.facets(e, job.ctx);
            const wanted =
                (landing.filters as string[] | undefined) ?? FILTERS_DEFAULT;
            const filters = wanted
                .map((f) => {
                    if (
                        f === "category" &&
                        facets.categories.length > 1 &&
                        e.type !== "category"
                    )
                        return {
                            key: "category",
                            param: "categoryId",
                            label: this.label("filters.category", lang),
                            options: facets.categories,
                        };
                    if (
                        f === "brand" &&
                        facets.brands.length > 1 &&
                        e.type !== "brand"
                    )
                        return {
                            key: "brand",
                            param: "brandId",
                            label: this.label("filters.brand", lang),
                            options: facets.brands,
                        };
                    if (f === "price" && facets.price)
                        return {
                            key: "price",
                            params: ["minPrice", "maxPrice"],
                            label: this.label("filters.price", lang),
                            range: facets.price,
                        };
                    if (f === "discount")
                        return {
                            key: "discount",
                            param: "minDiscountPct",
                            label: this.label("filters.discount", lang),
                            options: [10, 25, 40].map((p) => ({
                                id: String(p),
                                name: `${p}%+`,
                            })),
                        };
                    return null;
                })
                .filter(Boolean);
            const sorts = (
                (landing.sort as string[] | undefined) ?? [
                    "bestselling",
                    "price_asc",
                    "price_desc",
                    "discount",
                    "new",
                ]
            ).map((s) => ({ key: s, label: this.label(`sort.${s}`, lang) }));
            out.data = {
                filters,
                sort: {
                    param: "sort",
                    options: sorts,
                    selected: job.query?.sort ?? sorts[0]?.key ?? null,
                },
                selected: job.query ?? {},
                itemsUrl: job.entityUrl,
            };
            return;
        }
        if (n.source?.type === "entity") {
            delete out.lazy; // the page's main grid always comes filled
            const lay = landing.layout as
                | { columns?: number; cardVariant?: string }
                | undefined;
            if (lay?.columns)
                out.layout = {
                    ...((out.layout as object) ?? {}),
                    columns: lay.columns,
                };
            if (
                lay?.cardVariant &&
                def.variants.some((v) => v.key === lay.cardVariant)
            )
                out.variant = lay.cardVariant;
            const limit = Math.min(Number(n.source.limit ?? 20) || 20, 50);
            const page =
                limit === 20
                    ? await firstPage()
                    : await this.sources.resolve(
                          { type: "entity", limit, sort: n.source.sort },
                          job.ctx,
                          { entity: e, query: job.query },
                      );
            job.boundary.at(page.validUntil, job.now);
            out.data = {
                items: page.items,
                total: page.total ?? page.items.length,
                next: page.next
                    ? `${job.entityUrl}?${this.qs({ ...job.query, cursor: page.next, limit })}`
                    : null,
                itemsUrl: job.entityUrl,
            };
        }
    }

    private label(key: string, lang: string) {
        return this.i18n.translate(`sdui.${key}`, { lang }) as string;
    }

    private async slot(n: SduiNode | undefined, job: Job) {
        return n ? this.present(n as Node, job) : null;
    }

    /** Build a full page response. */
    private async page(
        layout: SduiLayout,
        ctx: RenderContext,
        segment: Segment,
        info: {
            key: string;
            kind: SduiScreenKind;
            title: Record<string, string>;
            version: number | null;
            variant: string | null;
            dataUrl: (id: string) => string;
            preview?: boolean;
        } & Partial<Pick<Job, "entity" | "entityUrl" | "query">>,
    ): Promise<{ value: Rendered; ttlSec: number }> {
        const expanded = await this.expand(layout);
        const job = await this.job(
            ctx,
            expanded,
            {
                dataUrl: info.dataUrl,
                entity: info.entity,
                entityUrl: info.entityUrl,
                query: info.query,
            },
            segment,
        );
        const appBar = await this.slot(expanded.appBar, job);
        const sections: Record<string, unknown>[] = [];
        for (const n of expanded.sections ?? []) {
            const node = await this.present(n as Node, job);
            if (node) sections.push(node);
        }
        const background =
            info.entity?.type === "group"
                ? info.entity.group.landing?.background
                : undefined;
        const settings =
            expanded.settings || background
                ? {
                      ...(expanded.settings ?? {}),
                      ...(background && { background }),
                  }
                : undefined;
        const body = {
            schemaVersion: SDUI_SCHEMA_VERSION,
            screen: {
                key: info.key,
                kind: info.kind,
                title: this.locale.pick(info.title, ctx.lang) || null,
                version: info.version,
                variant: info.variant,
                preview: info.preview ?? false,
            },
            ...(info.entity && {
                entity:
                    info.entity.type === "group"
                        ? { type: "group", key: info.entity.group.key }
                        : { type: info.entity.type, id: info.entity.entity.id },
            }),
            ...(info.query &&
                Object.keys(info.query).length && { query: info.query }),
            ...(appBar && { appBar }),
            sections,
            ...(settings && { settings }),
        };
        return this.finish(body, Math.min(RESPONSE_TTL, job.boundary.sec));
    }

    /** ETag over the content (not the TTL), TTL ≥ 1 s. */
    private finish(
        body: Record<string, unknown>,
        ttl: number,
    ): { value: Rendered; ttlSec: number } {
        const clean = plain(body);
        const ttlSec = Math.max(
            1,
            Math.floor(Number.isFinite(ttl) ? ttl : RESPONSE_TTL),
        );
        const etag = `"${checksum(clean).slice(0, 32)}"`;
        return { value: { body: { ...clean, ttlSec }, etag, ttlSec }, ttlSec };
    }

    private updateRequired(meta: ScreenMeta): Rendered {
        const body = {
            schemaVersion: SDUI_SCHEMA_VERSION,
            screen: { key: meta.key, kind: meta.kind, version: null },
            updateRequired: true,
            sections: [],
            ttlSec: 300,
        };
        return { body, etag: `"${checksum(body).slice(0, 32)}"`, ttlSec: 300 };
    }

    private pageOut(id: string, page: SourcePage, next: string | null) {
        const ttlSec = page.validUntil
            ? Math.max(
                  1,
                  Math.min(
                      30,
                      Math.ceil(
                          (new Date(page.validUntil).getTime() - Date.now()) /
                              1000,
                      ),
                  ),
              )
            : 30;
        return {
            body: plain({
                id,
                items: page.items,
                next,
                ...(page.total !== undefined && { total: page.total }),
                ...(page.meta && { meta: page.meta }),
                ttlSec,
            }),
            ttlSec,
        };
    }

    private async sectionData(
        layout: SduiLayout,
        key: string,
        nodeId: string,
        ctx: RenderContext,
        cursor: string | null | undefined,
        base: string,
    ) {
        const expanded = await this.expand(layout);
        const find = (nodes: SduiNode[] = []): Node | undefined => {
            for (const n of nodes) {
                if (n?.id === nodeId) return n;
                const c = find(n?.children);
                if (c) return c;
            }
        };
        const node = find(expanded.sections);
        const job = await this.job(
            ctx,
            {
                schemaVersion: SDUI_SCHEMA_VERSION,
                sections: node ? [node] : [],
            },
            { dataUrl: () => base },
        );
        if (
            !node?.source ||
            node.source.type === "entity" ||
            !this.visible(node._outer, job) ||
            !this.visible(node.visibility, job)
        )
            throw new NotFoundException({
                message: this.err.t("errors.sectionNotFound"),
                code: "SECTION_NOT_FOUND",
            });
        const page = await this.sources.resolve(node.source, ctx, {
            cursor,
            groups: job.groups,
        });
        const out = this.pageOut(
            nodeId,
            page,
            page.next ? `${base}cursor=${page.next}` : null,
        );
        // Personal pages: the app may keep them a little longer, they don't change with stock.
        return node.source.type === "reorder"
            ? { ...out, ttlSec: 60, personal: true }
            : { ...out, personal: false, key };
    }

    private async previewBody(
        screen: { key: string; kind: SduiScreenKind },
        layout: SduiLayout,
        ctx: RenderContext,
        opts: { entity?: EntityRef; query?: EntityQuery; token: string },
    ) {
        const entity = opts.entity
            ? await this.entity(opts.entity, ctx)
            : undefined;
        const segment = await this.segmentOf(ctx);
        const base = `app/preview/${opts.token}/sections`;
        const { value } = await this.page(layout, ctx, segment, {
            key: screen.key,
            kind: screen.kind,
            title:
                entity?.type === "group"
                    ? entity.group.title
                    : entity
                      ? entity.entity.name
                      : { en: screen.key },
            version: null,
            variant: null,
            preview: true,
            dataUrl: (id) => `${base}/${encodeURIComponent(id)}?`,
            entity,
            entityUrl: opts.entity
                ? `app/landing/${opts.entity.type}/${encodeURIComponent(opts.entity.ref)}/items`
                : undefined,
            query: opts.query ? this.cleanQuery(opts.query) : undefined,
        });
        if (screen.kind === SduiScreenKind.SHELL)
            return {
                ...value.body,
                theme: layout.theme ?? DEFAULT_THEME,
                bottomBar: await this.slot(
                    layout.bottomBar,
                    await this.job(ctx, layout, { dataUrl: () => base }),
                ),
            };
        return value.body;
    }
}
