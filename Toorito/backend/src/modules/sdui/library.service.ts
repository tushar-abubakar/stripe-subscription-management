import { AuthUser } from "@common/types/auth.type";
import { pageParams } from "@common/utils/helpers.util";
import { AuditService } from "@core/audit/audit.service";
import { PrismaService } from "@core/database/prisma.service";
import { LocaleService } from "@core/locale/locale.service";
import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma-client/client";
import { SduiGroupKind, SduiScreenKind } from "@prisma-client/enums";
import { LayoutValidatorService } from "./layout-validator.service";
import { LayoutIssue, LIBRARY_KEY_PATTERN, SduiNode } from "./schema/contract";
import { ScreensService } from "./screens.service";
import { GroupInput, SectionInput } from "./sdui.types";
import { plain, SduiCache, SduiErrors } from "./sdui.util";

type GroupItem = { type: "product" | "category" | "brand"; id: string };
const LANDING_KINDS: SduiScreenKind[] = ["TEMPLATE", "PAGE"];

/**
 * The designer's library:
 * - saved sections (placed with section_ref; editing one updates every screen),
 * - custom groups ("Fresh items", "Late night sale", "Newly added") with their
 *   items / rule, schedule and the landing design that opens on tap.
 * Both are read live by the app, so edits bump the cache generation, and
 * deleting one that a served screen uses is refused.
 */
@Injectable()
export class LibraryService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly validator: LayoutValidatorService,
        private readonly screens: ScreensService,
        private readonly cache: SduiCache,
        private readonly err: SduiErrors,
        private readonly audit: AuditService,
        private readonly locale: LocaleService,
    ) {}

    /** Ids whose language-map column matches `q` in any language. */
    private async jsonMatch(
        table: "SduiSection" | "SduiGroup",
        column: "name" | "title",
        q: string,
    ) {
        const rows = await this.prisma.$queryRaw<{ id: bigint }[]>(
            Prisma.sql`SELECT id FROM ${Prisma.raw(`"${table}"`)} WHERE "deletedAt" IS NULL
              AND EXISTS (SELECT 1 FROM jsonb_each_text(${Prisma.raw(`"${column}"`)}) t WHERE t.value ILIKE ${`%${q}%`}) LIMIT 500`,
        );
        return rows.map((r) => r.id);
    }

    // ---------------------------------------------------------------------
    // Saved sections
    // ---------------------------------------------------------------------

    async sections(q: {
        q?: string;
        type?: string;
        isActive?: boolean;
        page?: number;
        limit?: number;
    }) {
        const { take, skip, page, limit } = pageParams(q);
        const search = q.q?.trim();
        const where: Prisma.SduiSectionWhereInput = {
            deletedAt: null,
            ...(q.type && { type: q.type }),
            ...(q.isActive !== undefined && { isActive: q.isActive }),
            ...(search && {
                OR: [
                    { key: { contains: search, mode: "insensitive" } },
                    {
                        id: {
                            in: await this.jsonMatch(
                                "SduiSection",
                                "name",
                                search,
                            ),
                        },
                    },
                ],
            }),
        };
        const [items, total] = await Promise.all([
            this.prisma.sduiSection.findMany({
                where,
                orderBy: { updatedAt: "desc" },
                take,
                skip,
            }),
            this.prisma.sduiSection.count({ where }),
        ]);
        return { items, total, page, limit };
    }

    private async loadSection(id: bigint) {
        const s = await this.prisma.sduiSection.findFirst({
            where: { id, deletedAt: null },
        });
        if (!s) this.err.notFound("section");
        return s;
    }

    async section(id: bigint) {
        const s = await this.loadSection(id);
        return { ...s, usage: await this.screens.usage("sectionKeys", s.key) };
    }

    private async checkNode(node: unknown) {
        const r = this.validator.validateSectionNode(node);
        const errors = [...r.errors];
        const warnings = [...r.warnings];
        await this.validator.checkRefs(r.refs, errors, warnings);
        const fixed = errors.map((e) => ({
            ...e,
            path: e.path.replace(/^\/sections\/0/, "/node"),
        }));
        if (fixed.length) this.err.invalid(fixed, warnings);
        return (node as SduiNode).type;
    }

    private assertName(name: unknown) {
        if (!name || typeof name !== "object" || !Object.keys(name).length)
            this.err.bad("nameRequired", "NAME_REQUIRED");
    }

    async createSection(input: SectionInput, actor: AuthUser) {
        if (!LIBRARY_KEY_PATTERN.test(input.key))
            this.err.bad("invalidKey", "INVALID_KEY");
        this.assertName(input.name);
        if (
            await this.prisma.sduiSection.findUnique({
                where: { key: input.key },
            })
        )
            this.err.conflict("keyTaken", "KEY_TAKEN", {}, { key: input.key });
        const type = await this.checkNode(input.node);
        const s = await this.prisma.sduiSection.create({
            data: {
                key: input.key,
                name: input.name,
                node: input.node as Prisma.InputJsonValue,
                type,
                isActive: input.isActive ?? true,
                updatedById: actor.id,
            },
        });
        this.audit.log({
            actorId: actor.id,
            actorRole: actor.role,
            action: "sdui.section.create",
            entityType: "SduiSection",
            entityId: s.id,
            after: { key: s.key, type },
        });
        await this.cache.bump(); // the app may have cached "no such section" for this key
        return this.section(s.id);
    }

    /** Live on every screen using it. `revision` guards against overwriting a colleague. */
    async updateSection(
        id: bigint,
        input: Partial<Omit<SectionInput, "key">> & { revision: number },
        actor: AuthUser,
    ) {
        const s = await this.loadSection(id);
        if (input.revision !== s.revision)
            this.err.conflict("draftConflict", "SECTION_CONFLICT", {
                currentRevision: s.revision,
            });
        if (input.name !== undefined) this.assertName(input.name);
        const type =
            input.node !== undefined
                ? await this.checkNode(input.node)
                : undefined;
        const { count } = await this.prisma.sduiSection.updateMany({
            where: { id, revision: input.revision },
            data: {
                name: input.name,
                ...(input.node !== undefined && {
                    node: input.node as Prisma.InputJsonValue,
                    type,
                }),
                isActive: input.isActive,
                revision: { increment: 1 },
                updatedById: actor.id,
            },
        });
        if (!count) this.err.conflict("draftConflict", "SECTION_CONFLICT");
        await this.cache.bump();
        this.audit.log({
            actorId: actor.id,
            actorRole: actor.role,
            action: "sdui.section.update",
            entityType: "SduiSection",
            entityId: id,
            before: plain({ node: s.node, isActive: s.isActive }),
            after: plain(input),
        });
        return this.section(id);
    }

    async deleteSection(id: bigint, actor: AuthUser) {
        const s = await this.loadSection(id);
        const usage = await this.screens.usage("sectionKeys", s.key);
        if (usage.blocking)
            this.err.conflict("sectionInUse", "SECTION_IN_USE", { usage });
        // Free the key for reuse; the row stays for audit.
        await this.prisma.sduiSection.update({
            where: { id },
            data: {
                deletedAt: new Date(),
                isActive: false,
                key: `${s.key}~${s.id}`,
            },
        });
        await this.cache.bump();
        this.audit.log({
            actorId: actor.id,
            actorRole: actor.role,
            action: "sdui.section.delete",
            entityType: "SduiSection",
            entityId: id,
            before: { key: s.key },
        });
        return { success: true, draftsMentioning: usage.drafts };
    }

    // ---------------------------------------------------------------------
    // Custom groups
    // ---------------------------------------------------------------------

    async groups(q: {
        q?: string;
        kind?: SduiGroupKind;
        isActive?: boolean;
        page?: number;
        limit?: number;
    }) {
        const { take, skip, page, limit } = pageParams(q);
        const search = q.q?.trim();
        const where: Prisma.SduiGroupWhereInput = {
            deletedAt: null,
            ...(q.kind && { kind: q.kind }),
            ...(q.isActive !== undefined && { isActive: q.isActive }),
            ...(search && {
                OR: [
                    { key: { contains: search, mode: "insensitive" } },
                    {
                        id: {
                            in: await this.jsonMatch(
                                "SduiGroup",
                                "title",
                                search,
                            ),
                        },
                    },
                ],
            }),
        };
        const [rows, total] = await Promise.all([
            this.prisma.sduiGroup.findMany({
                where,
                orderBy: { updatedAt: "desc" },
                take,
                skip,
                include: {
                    landingScreen: {
                        select: { id: true, key: true, title: true },
                    },
                },
            }),
            this.prisma.sduiGroup.count({ where }),
        ]);
        return {
            items: rows.map((g) => ({
                ...g,
                itemCount: (g.items as unknown as GroupItem[]).length,
            })),
            total,
            page,
            limit,
        };
    }

    private async loadGroup(id: bigint) {
        const g = await this.prisma.sduiGroup.findFirst({
            where: { id, deletedAt: null },
            include: {
                landingScreen: {
                    select: { id: true, key: true, kind: true, title: true },
                },
            },
        });
        if (!g) this.err.notFound("group");
        return g;
    }

    /** Group + its manual items with names (in the admin's language) + where it's used. */
    async group(id: bigint, lang?: string) {
        const g = await this.loadGroup(id);
        const items = g.items as unknown as GroupItem[];
        const ids = (t: GroupItem["type"]) =>
            items.filter((i) => i.type === t).map((i) => BigInt(i.id));
        const [products, categories, brands] = await Promise.all([
            this.prisma.product.findMany({
                where: { id: { in: ids("product") } },
                select: {
                    id: true,
                    slug: true,
                    status: true,
                    deletedAt: true,
                    translations: { select: { lang: true, title: true } },
                },
            }),
            this.prisma.category.findMany({
                where: { id: { in: ids("category") } },
                select: { id: true, slug: true, name: true, status: true },
            }),
            this.prisma.brand.findMany({
                where: { id: { in: ids("brand") } },
                select: { id: true, slug: true, name: true, status: true },
            }),
        ]);
        const label = new Map<
            string,
            { name: string; slug: string; showable: boolean }
        >();
        for (const p of products)
            label.set(`product:${p.id}`, {
                name: this.locale.pick(
                    Object.fromEntries(
                        p.translations.map((t) => [t.lang, t.title]),
                    ),
                    lang,
                ),
                slug: p.slug,
                showable: p.status === "PUBLISHED" && !p.deletedAt,
            });
        for (const c of categories)
            label.set(`category:${c.id}`, {
                name: this.locale.pick(c.name, lang),
                slug: c.slug,
                showable: c.status === "ACTIVE",
            });
        for (const b of brands)
            label.set(`brand:${b.id}`, {
                name: this.locale.pick(b.name, lang),
                slug: b.slug,
                showable: b.status === "ACTIVE",
            });
        return {
            ...g,
            items: items.map((i) => ({
                ...i,
                ...(label.get(`${i.type}:${i.id}`) ?? {
                    name: null,
                    slug: null,
                    showable: false,
                }),
            })),
            usage: await this.screens.usage("groupKeys", g.key),
        };
    }

    private async checkGroup(input: Partial<GroupInput>, kind: SduiGroupKind) {
        const { issues, media } = this.validator.groupIssues(input);
        const errors: LayoutIssue[] = [...issues];
        if (kind === SduiGroupKind.RULE && input.rule === null)
            errors.push({
                path: "/rule",
                code: "RULE_REQUIRED",
                message: "a rule group needs a rule",
            });
        if (kind === SduiGroupKind.MANUAL && input.rule)
            errors.push({
                path: "/rule",
                code: "NOT_ALLOWED",
                message: "manual groups use items, not a rule",
            });
        if (kind === SduiGroupKind.RULE && input.items?.length)
            errors.push({
                path: "/items",
                code: "NOT_ALLOWED",
                message: "rule groups have no hand-picked items",
            });
        const items = input.items ?? [];
        if (
            new Set(items.map((i) => `${i.type}:${i.id}`)).size !== items.length
        )
            errors.push({
                path: "/items",
                code: "DUPLICATE_ITEM",
                message: "the same item is listed twice",
            });
        if (errors.length) this.err.invalid(errors);

        // Items exist, media usable, landing screen is a template / page.
        const ids = (t: GroupItem["type"]) =>
            items.filter((i) => i.type === t).map((i) => BigInt(i.id));
        const [p, c, b] = await Promise.all([
            this.prisma.product.count({
                where: { id: { in: ids("product") }, deletedAt: null },
            }),
            this.prisma.category.count({
                where: { id: { in: ids("category") } },
            }),
            this.prisma.brand.count({ where: { id: { in: ids("brand") } } }),
        ]);
        if (
            p !== ids("product").length ||
            c !== ids("category").length ||
            b !== ids("brand").length
        )
            errors.push({
                path: "/items",
                code: "ITEM_NOT_FOUND",
                message: "some products / categories / brands don't exist",
            });
        const warnings: LayoutIssue[] = [];
        await this.validator.checkRefs(
            { sections: [], groups: [], screens: [], media },
            errors,
            warnings,
        );
        if (input.landingScreenId) {
            const s = await this.prisma.sduiScreen.findFirst({
                where: { id: input.landingScreenId, deletedAt: null },
                select: { kind: true },
            });
            if (!s)
                errors.push({
                    path: "/landingScreenId",
                    code: "SCREEN_NOT_FOUND",
                    message: "landing screen doesn't exist",
                });
            else if (!LANDING_KINDS.includes(s.kind))
                errors.push({
                    path: "/landingScreenId",
                    code: "LANDING_KIND",
                    message: "the landing screen must be a TEMPLATE or a PAGE",
                });
        }
        if (errors.length) this.err.invalid(errors, warnings);
    }

    private groupData(input: Partial<GroupInput>) {
        const json = (v: unknown) =>
            v === null
                ? Prisma.JsonNull
                : (v as Prisma.InputJsonValue | undefined);
        return {
            title: input.title,
            subtitle: json(input.subtitle),
            media: json(input.media),
            items: input.items as Prisma.InputJsonValue | undefined,
            rule: json(input.rule),
            schedule: json(input.schedule),
            landingScreenId: input.landingScreenId,
            landing: json(input.landing),
            isActive: input.isActive,
        };
    }

    async createGroup(input: GroupInput, actor: AuthUser) {
        if (!LIBRARY_KEY_PATTERN.test(input.key))
            this.err.bad("invalidKey", "INVALID_KEY");
        this.assertName(input.title);
        if (
            await this.prisma.sduiGroup.findUnique({
                where: { key: input.key },
            })
        )
            this.err.conflict("keyTaken", "KEY_TAKEN", {}, { key: input.key });
        await this.checkGroup(
            {
                ...input,
                rule:
                    input.kind === SduiGroupKind.RULE
                        ? (input.rule ?? null)
                        : input.rule,
            },
            input.kind,
        );
        const g = await this.prisma.sduiGroup.create({
            data: {
                ...this.groupData(input),
                key: input.key,
                kind: input.kind,
                title: input.title,
                items: (input.items ?? []) as Prisma.InputJsonValue,
                updatedById: actor.id,
            },
        });
        this.audit.log({
            actorId: actor.id,
            actorRole: actor.role,
            action: "sdui.group.create",
            entityType: "SduiGroup",
            entityId: g.id,
            after: { key: g.key, kind: g.kind },
        });
        await this.cache.bump(); // the app may have cached "no such group" for this key
        return this.group(g.id);
    }

    async updateGroup(
        id: bigint,
        input: Partial<Omit<GroupInput, "key" | "kind">>,
        actor: AuthUser,
    ) {
        const g = await this.loadGroup(id);
        if (input.title !== undefined) this.assertName(input.title);
        await this.checkGroup(input, g.kind);
        await this.prisma.sduiGroup.update({
            where: { id },
            data: { ...this.groupData(input), updatedById: actor.id },
        });
        await this.cache.bump();
        this.audit.log({
            actorId: actor.id,
            actorRole: actor.role,
            action: "sdui.group.update",
            entityType: "SduiGroup",
            entityId: id,
            before: plain({
                items: g.items,
                rule: g.rule,
                schedule: g.schedule,
                isActive: g.isActive,
            }),
            after: plain(input),
        });
        return this.group(id);
    }

    async deleteGroup(id: bigint, actor: AuthUser) {
        const g = await this.loadGroup(id);
        const usage = await this.screens.usage("groupKeys", g.key);
        if (usage.blocking)
            this.err.conflict("groupInUse", "GROUP_IN_USE", { usage });
        await this.prisma.sduiGroup.update({
            where: { id },
            data: {
                deletedAt: new Date(),
                isActive: false,
                key: `${g.key}~${g.id}`,
            },
        });
        await this.cache.bump();
        this.audit.log({
            actorId: actor.id,
            actorRole: actor.role,
            action: "sdui.group.delete",
            entityType: "SduiGroup",
            entityId: id,
            before: { key: g.key },
        });
        return { success: true, draftsMentioning: usage.drafts };
    }
}
