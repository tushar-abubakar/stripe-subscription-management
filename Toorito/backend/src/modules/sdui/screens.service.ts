import { AuthUser } from "@common/types/auth.type";
import { pageParams } from "@common/utils/helpers.util";
import { AuditService } from "@core/audit/audit.service";
import { PrismaService } from "@core/database/prisma.service";
import { RedisService } from "@core/redis/redis.service";
import { Injectable, Logger, OnApplicationBootstrap } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { Prisma } from "@prisma-client/client";
import { SduiVersionStatus } from "@prisma-client/enums";
import { randomBytes } from "crypto";
import { LayoutValidatorService } from "./layout-validator.service";
import {
    SCREEN_KEY_PATTERN,
    SDUI_SCHEMA_VERSION,
    SduiLayout,
    SduiNode,
    SduiRule,
    SYSTEM_SCREENS,
} from "./schema/contract";
import { starterLayout } from "./schema/starters";
import {
    CreateScreenInput,
    PublishInput,
    RuleInput,
    SaveDraftInput,
    ScreenListInput,
    UpdateScreenInput,
} from "./sdui.types";
import { checksum, plain, SduiCache, SduiErrors } from "./sdui.util";

const VERSION_SUMMARY = {
    id: true,
    version: true,
    status: true,
    checksum: true,
    minAppVersion: true,
    sectionKeys: true,
    groupKeys: true,
    note: true,
    publishAt: true,
    publishedAt: true,
    publishedById: true,
    createdAt: true,
} satisfies Prisma.SduiScreenVersionSelect;

/**
 * Screen authoring: one editable draft per screen (autosave + optimistic lock),
 * immutable published versions, scheduling, rollback, diff and targeting
 * rules (JSON on the screen). Changes users can see bump the cache generation.
 */
@Injectable()
export class ScreensService implements OnApplicationBootstrap {
    private readonly log = new Logger(ScreensService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly redis: RedisService,
        private readonly validator: LayoutValidatorService,
        private readonly cache: SduiCache,
        private readonly err: SduiErrors,
        private readonly audit: AuditService,
    ) {}

    // ---------------------------------------------------------------------
    // System screens (idempotent, once per deploy)
    // ---------------------------------------------------------------------

    async onApplicationBootstrap() {
        const unlock = await this.redis.lock("sdui:bootstrap", 30);
        if (!unlock) return;
        try {
            const existing = new Set(
                (
                    await this.prisma.sduiScreen.findMany({
                        select: { key: true },
                    })
                ).map((s) => s.key),
            );
            for (const s of SYSTEM_SCREENS.filter((x) => !existing.has(x.key)))
                await this.prisma.sduiScreen.create({
                    data: {
                        ...s,
                        isSystem: true,
                        draftLayout: starterLayout(
                            s.kind,
                            s.key,
                        ) as unknown as Prisma.InputJsonValue,
                    },
                });
        } catch (e) {
            this.log.warn(`SDUI bootstrap skipped: ${(e as Error).message}`);
        } finally {
            await unlock();
        }
    }

    // ---------------------------------------------------------------------
    // Screens
    // ---------------------------------------------------------------------

    private async load(id: bigint) {
        const s = await this.prisma.sduiScreen.findFirst({
            where: { id, deletedAt: null },
        });
        if (!s) this.err.notFound("screen");
        return s;
    }

    async list(q: ScreenListInput) {
        const { take, skip, page, limit } = pageParams(q);
        const search = q.q?.trim();
        const where: Prisma.SduiScreenWhereInput = {
            deletedAt: null,
            ...(q.kind && { kind: q.kind }),
            ...(search && {
                OR: [
                    { key: { contains: search, mode: "insensitive" } },
                    // title is a language map: match any language
                    { id: { in: await this.titleMatches(search) } },
                ],
            }),
            ...(q.state === "live" && {
                liveVersionId: { not: null },
                isActive: true,
            }),
            ...(q.state === "never_published" && { liveVersionId: null }),
            ...(q.state === "inactive" && { isActive: false }),
            ...(q.state === "scheduled" && {
                versions: { some: { status: SduiVersionStatus.SCHEDULED } },
            }),
        };
        const all = q.state === "unpublished_changes";
        const [rows, total] = await Promise.all([
            this.prisma.sduiScreen.findMany({
                where,
                orderBy: [{ isSystem: "desc" }, { key: "asc" }],
                ...(!all && { take, skip }),
                include: {
                    liveVersion: { select: VERSION_SUMMARY },
                    versions: {
                        where: { status: SduiVersionStatus.SCHEDULED },
                        select: { version: true, publishAt: true },
                        orderBy: { publishAt: "asc" },
                        take: 1,
                    },
                    _count: { select: { groups: true } },
                },
            }),
            this.prisma.sduiScreen.count({ where }),
        ]);
        let items = rows.map(
            ({ draftLayout, liveVersion, versions, rules, _count, ...s }) => ({
                ...s,
                liveVersion,
                nextScheduled: versions[0] ?? null,
                activeRules: (rules as unknown as SduiRule[]).filter(
                    (r) => r.isActive,
                ).length,
                usedAsLandingBy: _count.groups,
                hasUnpublishedChanges:
                    !liveVersion ||
                    checksum(draftLayout) !== liveVersion.checksum,
            }),
        );
        if (all) {
            items = items.filter((i) => i.hasUnpublishedChanges);
            return {
                items: items.slice(skip, skip + take),
                total: items.length,
                page,
                limit,
            };
        }
        return { items, total, page, limit };
    }

    private async titleMatches(q: string) {
        const rows = await this.prisma.$queryRaw<{ id: bigint }[]>`
            SELECT id FROM "SduiScreen" WHERE "deletedAt" IS NULL
              AND EXISTS (SELECT 1 FROM jsonb_each_text(title) t WHERE t.value ILIKE ${`%${q}%`}) LIMIT 500`;
        return rows.map((r) => r.id);
    }

    /** Everything the designer opens: draft (+ structural issues), live version, schedule, rules, groups landing here. */
    /** Key, kind and draft (what the designer preview renders). */
    async draftOf(id: bigint) {
        const s = await this.prisma.sduiScreen.findFirst({
            where: { id, deletedAt: null },
            select: { key: true, kind: true, draftLayout: true },
        });
        if (!s) this.err.notFound("screen");
        return s;
    }

    async get(id: bigint) {
        const s = await this.prisma.sduiScreen.findFirst({
            where: { id, deletedAt: null },
            include: {
                liveVersion: { select: VERSION_SUMMARY },
                versions: {
                    where: { status: SduiVersionStatus.SCHEDULED },
                    select: VERSION_SUMMARY,
                    orderBy: { publishAt: "asc" },
                },
                groups: {
                    where: { deletedAt: null },
                    select: { id: true, key: true, title: true },
                },
            },
        });
        if (!s) this.err.notFound("screen");
        const { versions, groups, ...rest } = s;
        const structure = this.validator.validateStructure(
            s.draftLayout,
            s.kind,
        );
        return {
            ...rest,
            scheduled: versions,
            usedAsLandingBy: groups,
            hasUnpublishedChanges:
                !s.liveVersion ||
                checksum(s.draftLayout) !== s.liveVersion.checksum,
            draftIssues: {
                errors: structure.errors,
                warnings: structure.warnings,
            },
        };
    }

    async create(input: CreateScreenInput, actor: AuthUser) {
        if (!SCREEN_KEY_PATTERN.test(input.key))
            this.err.bad("invalidKey", "INVALID_KEY");
        if (input.kind === "SHELL") this.err.bad("oneShell", "SHELL_EXISTS");
        if (input.kind === "PAGE" && !input.key.startsWith("page:"))
            this.err.bad("pageKey", "PAGE_KEY_PREFIX");
        if (
            await this.prisma.sduiScreen.findUnique({
                where: { key: input.key },
            })
        )
            this.err.conflict("keyTaken", "KEY_TAKEN", {}, { key: input.key });

        let layout: unknown = starterLayout(input.kind, input.key);
        if (input.copyFrom) {
            const src = await this.load(input.copyFrom.screenId);
            layout = input.copyFrom.version
                ? (await this.versionRow(src.id, input.copyFrom.version)).layout
                : src.draftLayout;
        }
        const s = await this.prisma.sduiScreen.create({
            data: {
                key: input.key,
                kind: input.kind,
                title: input.title,
                description: input.description,
                draftLayout: layout as Prisma.InputJsonValue,
                createdById: actor.id,
                draftUpdatedById: actor.id,
                draftUpdatedAt: new Date(),
            },
        });
        this.audit.log({
            actorId: actor.id,
            actorRole: actor.role,
            action: "sdui.screen.create",
            entityType: "SduiScreen",
            entityId: s.id,
            after: { key: s.key, kind: s.kind },
        });
        return this.get(s.id);
    }

    async update(id: bigint, input: UpdateScreenInput, actor: AuthUser) {
        const s = await this.load(id);
        if (input.isActive === false && s.isSystem)
            this.err.bad("systemScreen", "SYSTEM_SCREEN");
        await this.prisma.sduiScreen.update({
            where: { id },
            data: {
                title: input.title,
                description:
                    input.description === null
                        ? Prisma.JsonNull
                        : input.description,
                isActive: input.isActive,
            },
        });
        if (input.isActive !== undefined && input.isActive !== s.isActive)
            await this.cache.bump();
        this.audit.log({
            actorId: actor.id,
            actorRole: actor.role,
            action: "sdui.screen.update",
            entityType: "SduiScreen",
            entityId: id,
            before: plain({ title: s.title, isActive: s.isActive }),
            after: plain(input),
        });
        return this.get(id);
    }

    /** Soft delete; the key stays reserved. Refused for system screens and landing templates still used by groups. */
    async remove(id: bigint, actor: AuthUser) {
        const s = await this.load(id);
        if (s.isSystem) this.err.bad("systemScreen", "SYSTEM_SCREEN");
        const groups = await this.prisma.sduiGroup.findMany({
            where: { landingScreenId: id, deletedAt: null },
            select: { key: true },
        });
        if (groups.length)
            this.err.conflict("landingInUse", "LANDING_IN_USE", {
                groups: groups.map((g) => g.key),
            });
        await this.prisma.sduiScreen.update({
            where: { id },
            data: { deletedAt: new Date(), isActive: false },
        });
        await this.cache.bump();
        this.audit.log({
            actorId: actor.id,
            actorRole: actor.role,
            action: "sdui.screen.delete",
            entityType: "SduiScreen",
            entityId: id,
            before: { key: s.key },
        });
        return { success: true };
    }

    // ---------------------------------------------------------------------
    // Draft
    // ---------------------------------------------------------------------

    /** Autosave: saved even with content problems (returned as issues); refused on a broken shape or a newer save. */
    async saveDraft(id: bigint, input: SaveDraftInput, actor: AuthUser) {
        const s = await this.load(id);
        const shape = this.validator.assertShape(input.layout);
        if (shape.length) this.err.invalid(shape);
        const { count } = await this.prisma.sduiScreen.updateMany({
            where: { id, draftRevision: input.revision, deletedAt: null },
            data: {
                draftLayout: input.layout as Prisma.InputJsonValue,
                draftRevision: { increment: 1 },
                draftUpdatedById: actor.id,
                draftUpdatedAt: new Date(),
            },
        });
        if (!count) {
            const now = await this.prisma.sduiScreen.findUniqueOrThrow({
                where: { id },
                select: {
                    draftRevision: true,
                    draftUpdatedById: true,
                    draftUpdatedAt: true,
                },
            });
            this.err.conflict("draftConflict", "DRAFT_CONFLICT", {
                currentRevision: now.draftRevision,
                updatedById: now.draftUpdatedById?.toString() ?? null,
                updatedAt: now.draftUpdatedAt,
            });
        }
        const structure = this.validator.validateStructure(
            input.layout,
            s.kind,
        );
        return {
            revision: input.revision + 1,
            savedAt: new Date(),
            checksum: checksum(input.layout),
            issues: { errors: structure.errors, warnings: structure.warnings },
        };
    }

    async discardDraft(id: bigint, actor: AuthUser) {
        const s = await this.prisma.sduiScreen.findFirst({
            where: { id, deletedAt: null },
            include: { liveVersion: { select: { layout: true } } },
        });
        if (!s) this.err.notFound("screen");
        await this.prisma.sduiScreen.update({
            where: { id },
            data: {
                draftLayout: (s.liveVersion?.layout ??
                    starterLayout(
                        s.kind,
                        s.key,
                    )) as unknown as Prisma.InputJsonValue,
                draftRevision: { increment: 1 },
                draftUpdatedById: actor.id,
                draftUpdatedAt: new Date(),
            },
        });
        return this.get(id);
    }

    /** Full check incl. references — what Publish runs. */
    async validate(id: bigint, layout?: unknown) {
        const s = await this.load(id);
        const r = await this.validator.validateLayout(
            layout ?? s.draftLayout,
            s.kind,
            { selfKey: s.key },
        );
        return { valid: !r.errors.length, ...r };
    }

    // ---------------------------------------------------------------------
    // Publish / versions
    // ---------------------------------------------------------------------

    async publish(id: bigint, input: PublishInput, actor: AuthUser) {
        const s = await this.prisma.sduiScreen.findFirst({
            where: { id, deletedAt: null },
            include: { liveVersion: { select: { checksum: true } } },
        });
        if (!s) this.err.notFound("screen");
        if (input.revision !== undefined && input.revision !== s.draftRevision)
            this.err.conflict("draftChanged", "DRAFT_CHANGED", {
                currentRevision: s.draftRevision,
            });
        const makeLive = input.makeLive ?? true;
        const scheduled =
            !!input.publishAt &&
            input.publishAt.getTime() > Date.now() + 30_000;
        if (scheduled && !makeLive)
            this.err.bad("scheduleVariant", "SCHEDULE_NEEDS_LIVE");

        const r = await this.validator.validateLayout(s.draftLayout, s.kind, {
            selfKey: s.key,
        });
        if (r.errors.length) this.err.invalid(r.errors, r.warnings);
        const sum = checksum(s.draftLayout);
        if (makeLive && !scheduled && s.liveVersion?.checksum === sum)
            this.err.conflict("nothingToPublish", "NOTHING_TO_PUBLISH");

        const version = await this.prisma.$transaction(async (tx) => {
            await tx.$queryRaw`SELECT id FROM "SduiScreen" WHERE id = ${id} FOR UPDATE`;
            const last = await tx.sduiScreenVersion.aggregate({
                where: { screenId: id },
                _max: { version: true },
            });
            const v = await tx.sduiScreenVersion.create({
                data: {
                    screenId: id,
                    version: (last._max.version ?? 0) + 1,
                    status: scheduled
                        ? SduiVersionStatus.SCHEDULED
                        : SduiVersionStatus.PUBLISHED,
                    layout: s.draftLayout as Prisma.InputJsonValue,
                    schemaVersion: SDUI_SCHEMA_VERSION,
                    minAppVersion: r.deps.minAppVersion,
                    checksum: sum,
                    sectionKeys: r.deps.sectionKeys,
                    groupKeys: r.deps.groupKeys,
                    note: input.note,
                    publishAt: scheduled ? input.publishAt : null,
                    publishedAt: scheduled ? null : new Date(),
                    publishedById: actor.id,
                },
                select: VERSION_SUMMARY,
            });
            if (makeLive && !scheduled)
                await tx.sduiScreen.update({
                    where: { id },
                    data: { liveVersionId: v.id },
                });
            return v;
        });
        if (!scheduled) await this.cache.bump();
        this.audit.log({
            actorId: actor.id,
            actorRole: actor.role,
            action: scheduled ? "sdui.screen.schedule" : "sdui.screen.publish",
            entityType: "SduiScreen",
            entityId: id,
            after: {
                version: version.version,
                makeLive,
                publishAt: input.publishAt,
                note: input.note,
            },
        });
        return {
            ...version,
            live: makeLive && !scheduled,
            warnings: r.warnings,
        };
    }

    async versions(id: bigint, q: { page?: number; limit?: number }) {
        const s = await this.load(id);
        const { take, skip, page, limit } = pageParams(q);
        const [rows, total] = await Promise.all([
            this.prisma.sduiScreenVersion.findMany({
                where: { screenId: id },
                orderBy: { version: "desc" },
                take,
                skip,
                select: VERSION_SUMMARY,
            }),
            this.prisma.sduiScreenVersion.count({ where: { screenId: id } }),
        ]);
        const ruled = new Set(
            (s.rules as unknown as SduiRule[]).map((r) => r.versionId),
        );
        return {
            items: rows.map((v) => ({
                ...v,
                isLive: v.id === s.liveVersionId,
                usedByRules: ruled.has(v.id.toString()),
            })),
            total,
            page,
            limit,
        };
    }

    private async versionRow(id: bigint, version: number) {
        const v = await this.prisma.sduiScreenVersion.findUnique({
            where: { screenId_version: { screenId: id, version } },
        });
        if (!v) this.err.notFound("version");
        return v;
    }

    async version(id: bigint, version: number) {
        const s = await this.load(id);
        const v = await this.versionRow(id, version);
        return { ...v, isLive: v.id === s.liveVersionId };
    }

    /** Section-level diff of a version against the live version, the draft or another version. */
    async diff(
        id: bigint,
        version: number,
        against: "live" | "draft" | number,
    ) {
        const s = await this.prisma.sduiScreen.findFirst({
            where: { id, deletedAt: null },
            include: {
                liveVersion: { select: { version: true, layout: true } },
            },
        });
        if (!s) this.err.notFound("screen");
        const left = await this.versionRow(id, version);
        const right =
            against === "draft"
                ? { label: "draft", layout: s.draftLayout }
                : against === "live"
                  ? s.liveVersion
                      ? {
                            label: `v${s.liveVersion.version} (live)`,
                            layout: s.liveVersion.layout,
                        }
                      : this.err.bad("noLive", "NO_LIVE_VERSION")
                  : {
                        label: `v${against}`,
                        layout: (await this.versionRow(id, against)).layout,
                    };
        return {
            from: `v${left.version}`,
            to: right.label,
            ...this.diffLayouts(
                left.layout as unknown as SduiLayout,
                right.layout as unknown as SduiLayout,
            ),
        };
    }

    private diffLayouts(a: SduiLayout, b: SduiLayout) {
        const index = (l: SduiLayout) => {
            const m = new Map<
                string,
                { node: SduiNode; index: number; slot: string }
            >();
            (l?.sections ?? []).forEach(
                (n, i) =>
                    n?.id &&
                    m.set(n.id, { node: n, index: i, slot: "sections" }),
            );
            if (l?.appBar?.id)
                m.set(l.appBar.id, {
                    node: l.appBar,
                    index: 0,
                    slot: "appBar",
                });
            if (l?.bottomBar?.id)
                m.set(l.bottomBar.id, {
                    node: l.bottomBar,
                    index: 0,
                    slot: "bottomBar",
                });
            return m;
        };
        const ma = index(a);
        const mb = index(b);
        const fields = [
            "type",
            "variant",
            "header",
            "layout",
            "style",
            "props",
            "source",
            "items",
            "children",
            "action",
            "visibility",
            "lazy",
            "ref",
        ];
        const changed: { id: string; type: string; fields: string[] }[] = [];
        const moved: { id: string; from: number; to: number }[] = [];
        for (const [nodeId, x] of ma) {
            const y = mb.get(nodeId);
            if (!y) continue;
            if (x.index !== y.index && x.slot === y.slot)
                moved.push({ id: nodeId, from: x.index, to: y.index });
            const diff = fields.filter(
                (f) =>
                    checksum(
                        (x.node as unknown as Record<string, unknown>)[f] ??
                            null,
                    ) !==
                    checksum(
                        (y.node as unknown as Record<string, unknown>)[f] ??
                            null,
                    ),
            );
            if (diff.length)
                changed.push({ id: nodeId, type: y.node.type, fields: diff });
        }
        const pick = (x: { node: SduiNode; index: number; slot: string }) => ({
            id: x.node.id,
            type: x.node.type,
            slot: x.slot,
            index: x.index,
        });
        return {
            identical: checksum(a) === checksum(b),
            added: [...mb].filter(([k]) => !ma.has(k)).map(([, x]) => pick(x)),
            removed: [...ma]
                .filter(([k]) => !mb.has(k))
                .map(([, x]) => pick(x)),
            moved,
            changed,
            themeChanged:
                checksum(a?.theme ?? null) !== checksum(b?.theme ?? null),
            settingsChanged:
                checksum(a?.settings ?? null) !== checksum(b?.settings ?? null),
        };
    }

    /** Promote a variant / roll back to an older version. References are re-checked. */
    async makeLive(id: bigint, version: number, actor: AuthUser) {
        const s = await this.load(id);
        const v = await this.versionRow(id, version);
        if (v.status !== SduiVersionStatus.PUBLISHED)
            this.err.bad("notPublished", "VERSION_NOT_PUBLISHED");
        const r = await this.validator.validateLayout(v.layout, s.kind, {
            selfKey: s.key,
        });
        if (r.errors.length) this.err.invalid(r.errors, r.warnings);
        await this.prisma.sduiScreen.update({
            where: { id },
            data: { liveVersionId: v.id },
        });
        await this.cache.bump();
        this.audit.log({
            actorId: actor.id,
            actorRole: actor.role,
            action: "sdui.screen.make_live",
            entityType: "SduiScreen",
            entityId: id,
            before: { liveVersionId: s.liveVersionId },
            after: { version },
        });
        return this.get(id);
    }

    async cancelScheduled(id: bigint, version: number, actor: AuthUser) {
        await this.load(id);
        const v = await this.versionRow(id, version);
        if (v.status !== SduiVersionStatus.SCHEDULED)
            this.err.bad("notScheduled", "VERSION_NOT_SCHEDULED");
        await this.prisma.sduiScreenVersion.update({
            where: { id: v.id },
            data: { status: SduiVersionStatus.CANCELLED },
        });
        this.audit.log({
            actorId: actor.id,
            actorRole: actor.role,
            action: "sdui.screen.cancel_schedule",
            entityType: "SduiScreen",
            entityId: id,
            after: { version },
        });
        return { success: true };
    }

    async restoreToDraft(id: bigint, version: number, actor: AuthUser) {
        await this.load(id);
        const v = await this.versionRow(id, version);
        await this.prisma.sduiScreen.update({
            where: { id },
            data: {
                draftLayout: v.layout as Prisma.InputJsonValue,
                draftRevision: { increment: 1 },
                draftUpdatedById: actor.id,
                draftUpdatedAt: new Date(),
            },
        });
        return this.get(id);
    }

    /** Scheduled versions go live (every minute, one instance). */
    @Cron(CronExpression.EVERY_MINUTE)
    async publishDue() {
        const unlock = await this.redis.lock("cron:sdui-publish", 50);
        if (!unlock) return;
        try {
            const due = await this.prisma.sduiScreenVersion.findMany({
                where: {
                    status: SduiVersionStatus.SCHEDULED,
                    publishAt: { lte: new Date() },
                },
                orderBy: { publishAt: "asc" },
            });
            for (const v of due) {
                await this.prisma.$transaction([
                    this.prisma.sduiScreenVersion.update({
                        where: { id: v.id },
                        data: {
                            status: SduiVersionStatus.PUBLISHED,
                            publishedAt: new Date(),
                        },
                    }),
                    this.prisma.sduiScreen.update({
                        where: { id: v.screenId },
                        data: { liveVersionId: v.id },
                    }),
                ]);
                this.log.log(
                    `SDUI screen ${v.screenId} v${v.version} went live (scheduled)`,
                );
            }
            if (due.length) await this.cache.bump();
        } finally {
            await unlock();
        }
    }

    // ---------------------------------------------------------------------
    // Targeting rules (JSON array on the screen)
    // ---------------------------------------------------------------------

    private sortRules = (rules: SduiRule[]) =>
        [...rules].sort(
            (a, b) => a.priority - b.priority || a.id.localeCompare(b.id),
        );

    /** Rules with their version number for display. */
    async rules(id: bigint) {
        const s = await this.load(id);
        const rules = s.rules as unknown as SduiRule[];
        const versions = await this.prisma.sduiScreenVersion.findMany({
            where: { id: { in: rules.map((r) => BigInt(r.versionId)) } },
            select: {
                id: true,
                version: true,
                status: true,
                minAppVersion: true,
            },
        });
        const byId = new Map(versions.map((v) => [v.id.toString(), v]));
        return this.sortRules(rules).map((r) => ({
            ...r,
            version: byId.get(r.versionId) ?? null,
        }));
    }

    private async ruleFields(
        screenId: bigint,
        input: Partial<RuleInput>,
        current?: SduiRule,
    ) {
        if (input.conditions !== undefined) {
            const issues = this.validator.conditionsIssues(input.conditions);
            if (issues.length) this.err.invalid(issues);
        }
        let versionId = current?.versionId;
        if (input.version !== undefined) {
            const v = await this.versionRow(screenId, input.version);
            if (v.status !== SduiVersionStatus.PUBLISHED)
                this.err.bad("notPublished", "VERSION_NOT_PUBLISHED");
            versionId = v.id.toString();
        }
        const startsAt =
            input.startsAt !== undefined
                ? (input.startsAt?.toISOString() ?? null)
                : (current?.startsAt ?? null);
        const endsAt =
            input.endsAt !== undefined
                ? (input.endsAt?.toISOString() ?? null)
                : (current?.endsAt ?? null);
        if (startsAt && endsAt && startsAt >= endsAt)
            this.err.bad("invalidWindow", "INVALID_WINDOW");
        return {
            name: input.name ?? current?.name ?? "",
            versionId: versionId!,
            priority: input.priority ?? current?.priority ?? 100,
            isActive: input.isActive ?? current?.isActive ?? true,
            startsAt,
            endsAt,
            conditions: input.conditions ?? current?.conditions ?? {},
        };
    }

    /** Read-modify-write of the rules array under a row lock. */
    private async writeRules(
        id: bigint,
        fn: (rules: SduiRule[]) => SduiRule[],
        actor: AuthUser,
        action: string,
    ) {
        await this.prisma.$transaction(async (tx) => {
            const [row] = await tx.$queryRaw<
                { rules: SduiRule[] }[]
            >`SELECT rules FROM "SduiScreen" WHERE id = ${id} AND "deletedAt" IS NULL FOR UPDATE`;
            if (!row) this.err.notFound("screen");
            const next = fn(row.rules ?? []);
            await tx.sduiScreen.update({
                where: { id },
                data: {
                    rules: this.sortRules(
                        next,
                    ) as unknown as Prisma.InputJsonValue,
                },
            });
            this.audit.log({
                actorId: actor.id,
                actorRole: actor.role,
                action,
                entityType: "SduiScreen",
                entityId: id,
                before: row.rules,
                after: next,
            });
        });
        await this.cache.bump();
        return this.rules(id);
    }

    async createRule(id: bigint, input: RuleInput, actor: AuthUser) {
        await this.load(id);
        const fields = await this.ruleFields(id, input);
        const rule: SduiRule = {
            id: randomBytes(6).toString("hex"),
            ...fields,
            createdById: actor.id.toString(),
            updatedAt: new Date().toISOString(),
        };
        return this.writeRules(
            id,
            (rules) => [...rules, rule],
            actor,
            "sdui.rule.create",
        );
    }

    async updateRule(
        id: bigint,
        ruleId: string,
        input: Partial<RuleInput>,
        actor: AuthUser,
    ) {
        const s = await this.load(id);
        const current = (s.rules as unknown as SduiRule[]).find(
            (r) => r.id === ruleId,
        );
        if (!current) this.err.notFound("rule");
        const fields = await this.ruleFields(id, input, current);
        return this.writeRules(
            id,
            (rules) =>
                rules.map((r) =>
                    r.id === ruleId
                        ? {
                              ...r,
                              ...fields,
                              updatedAt: new Date().toISOString(),
                          }
                        : r,
                ),
            actor,
            "sdui.rule.update",
        );
    }

    async deleteRule(id: bigint, ruleId: string, actor: AuthUser) {
        const s = await this.load(id);
        if (!(s.rules as unknown as SduiRule[]).some((r) => r.id === ruleId))
            this.err.notFound("rule");
        return this.writeRules(
            id,
            (rules) => rules.filter((r) => r.id !== ruleId),
            actor,
            "sdui.rule.delete",
        );
    }

    // ---------------------------------------------------------------------
    // Where-used (saved sections / custom groups)
    // ---------------------------------------------------------------------

    /**
     * Screens whose live / scheduled / rule versions use a section or group
     * (`blocking` = users see it now), and drafts that mention it.
     */
    async usage(field: "sectionKeys" | "groupKeys", key: string) {
        const screens = await this.prisma.sduiScreen.findMany({
            where: { deletedAt: null },
            select: { id: true, liveVersionId: true, rules: true },
        });
        const served = new Set<string>();
        for (const s of screens) {
            if (s.liveVersionId) served.add(s.liveVersionId.toString());
            for (const r of s.rules as unknown as SduiRule[])
                if (r.isActive) served.add(r.versionId);
        }
        const versions = await this.prisma.sduiScreenVersion.findMany({
            where: {
                [field]: { has: key },
                OR: [
                    { id: { in: [...served].map(BigInt) } },
                    { status: SduiVersionStatus.SCHEDULED },
                ],
                screen: { deletedAt: null },
            },
            select: {
                version: true,
                status: true,
                screen: { select: { id: true, key: true, title: true } },
            },
        });
        const path =
            field === "sectionKeys"
                ? "$.** ? (@.ref == $k)"
                : "$.** ? (@.key == $k || @.keys[*] == $k)";
        const drafts = await this.prisma.$queryRaw<
            { id: bigint; key: string }[]
        >`
            SELECT id, key FROM "SduiScreen"
            WHERE "deletedAt" IS NULL AND jsonb_path_exists("draftLayout", ${path}::jsonpath, jsonb_build_object('k', ${key}::text))`;
        return {
            blocking: versions.length > 0,
            versions: versions.map((v) => ({
                screenId: v.screen.id,
                screenKey: v.screen.key,
                screenTitle: v.screen.title,
                version: v.version,
                status: v.status,
            })),
            drafts,
        };
    }
}
