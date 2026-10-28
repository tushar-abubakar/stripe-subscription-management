import { PrismaService } from "@core/database/prisma.service";
import { Injectable } from "@nestjs/common";
import {
    MediaPurpose,
    MediaStatus,
    MediaType,
    SduiScreenKind,
} from "@prisma-client/enums";
import Ajv, { ErrorObject, ValidateFunction } from "ajv";
import addFormats from "ajv-formats";
import {
    COMPONENT_MAP,
    COMPONENTS,
    ComponentDef,
} from "./schema/component.registry";
import {
    LayoutDeps,
    LayoutIssue,
    NODE_ID_PATTERN,
    SDUI_LIMITS,
    SDUI_SCHEMA_VERSION,
    SduiNode,
    Slot,
} from "./schema/contract";
import {
    ACTION_SCHEMA,
    ACTIONS,
    CONDITIONS_SCHEMA,
    GROUP_ITEMS_SCHEMA,
    GROUP_LANDING_SCHEMA,
    GROUP_MEDIA_SCHEMA,
    GROUP_RULE_SCHEMA,
    GROUP_SCHEDULE_SCHEMA,
    HEADER_SCHEMA,
    JsonSchema,
    LAYOUT_SCHEMA,
    SOURCE_MAP,
    SOURCES,
    STYLE_SCHEMA,
    THEME_SCHEMA,
    VISIBILITY_SCHEMA,
} from "./schema/definitions";

/** Media purposes a layout / group may show (public, visual). */
const LAYOUT_MEDIA_PURPOSES: MediaPurpose[] = [
    MediaPurpose.BANNER,
    MediaPurpose.PRODUCT,
    MediaPurpose.CATEGORY,
    MediaPurpose.CATEGORY_BANNER,
    MediaPurpose.BRAND,
    MediaPurpose.BRAND_BANNER,
    MediaPurpose.BUNDLE,
    MediaPurpose.OTHER,
];
const NODE_FIELDS = [
    "id",
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

/**
 * Walks a value next to its JSON Schema and reports localized texts / media
 * refs / actions. Validation (media checks) and the renderer (localise,
 * resolve media) share it, so only this file knows the annotations.
 */
export function walkSchema(
    value: unknown,
    schema: JsonSchema | undefined,
    path: string,
    visit: (
        kind: "text" | "media" | "action",
        value: any,
        path: string,
        schema: JsonSchema,
    ) => void,
): void {
    if (!schema || value === null || value === undefined) return;
    if (schema.$ref === "sdui://action") {
        visit("action", value, path, schema);
        const def = ACTIONS.find(
            (a) => a.type === (value as { type?: string })?.type,
        );
        return walkSchema(value, def?.schema, path, visit);
    }
    if (schema["x-localized"]) return visit("text", value, path, schema);
    if (schema["x-media"]) return visit("media", value, path, schema);
    if (Array.isArray(value))
        return value.forEach((v, i) =>
            walkSchema(v, schema.items as JsonSchema, `${path}/${i}`, visit),
        );
    if (typeof value === "object") {
        const props = schema.properties as
            | Record<string, JsonSchema>
            | undefined;
        for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
            const child =
                props?.[k] ??
                (typeof schema.additionalProperties === "object"
                    ? (schema.additionalProperties as JsonSchema)
                    : undefined);
            walkSchema(v, child, `${path}/${k}`, visit);
        }
    }
}

/** "1.10.0" > "1.9.3". */
export const compareVersions = (a: string, b: string) => {
    const pa = a.split(".").map(Number);
    const pb = b.split(".").map(Number);
    for (let i = 0; i < 3; i++)
        if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0);
    return 0;
};

interface Ref {
    key: string;
    path: string;
    nodeId?: string;
}
interface MediaRef extends Ref {
    kinds: string[];
}
interface WalkCtx {
    kind: SduiScreenKind;
    ids: Set<string>;
    count: number;
    components: Set<string>;
    versions: string[];
    media: MediaRef[];
    sections: Ref[];
    groups: Ref[];
    screens: Ref[];
}

export interface ValidationResult {
    errors: LayoutIssue[];
    warnings: LayoutIssue[];
    deps: LayoutDeps;
}

/**
 * Validates layouts, library sections, custom groups, rules and the theme.
 * Structure is checked in memory; `validateLayout` also confirms that saved
 * sections, groups, media and linked screens exist.
 *
 * Drafts save even with errors (half-built designs); publishing needs zero.
 */
@Injectable()
export class LayoutValidatorService {
    private readonly ajv = new Ajv({ allErrors: true, strict: false });
    private readonly propsV = new Map<string, ValidateFunction>();
    private readonly itemsV = new Map<string, ValidateFunction>();
    private readonly sourceV = new Map<string, ValidateFunction>();
    private readonly v: Record<string, ValidateFunction>;

    constructor(private readonly prisma: PrismaService) {
        addFormats(this.ajv);
        this.ajv.addKeyword({ keyword: "x-localized", schemaType: "boolean" });
        this.ajv.addKeyword({ keyword: "x-media", schemaType: "array" });
        this.ajv.addSchema(ACTION_SCHEMA);
        for (const c of COMPONENTS) {
            if (c.propsSchema)
                this.propsV.set(c.type, this.ajv.compile(c.propsSchema));
            if (c.items)
                this.itemsV.set(
                    c.type,
                    this.ajv.compile({
                        type: "array",
                        minItems: c.items.min,
                        maxItems: c.items.max,
                        items: c.items.schema,
                    }),
                );
        }
        for (const s of SOURCES)
            this.sourceV.set(s.type, this.ajv.compile(s.schema));
        this.v = {
            action: this.ajv.getSchema("sdui://action")!,
            header: this.ajv.compile(HEADER_SCHEMA),
            layout: this.ajv.compile(LAYOUT_SCHEMA),
            style: this.ajv.compile(STYLE_SCHEMA),
            visibility: this.ajv.compile(VISIBILITY_SCHEMA),
            conditions: this.ajv.compile(CONDITIONS_SCHEMA),
            theme: this.ajv.compile(THEME_SCHEMA),
            groupItems: this.ajv.compile(GROUP_ITEMS_SCHEMA),
            groupRule: this.ajv.compile(GROUP_RULE_SCHEMA),
            groupSchedule: this.ajv.compile(GROUP_SCHEDULE_SCHEMA),
            groupMedia: this.ajv.compile(GROUP_MEDIA_SCHEMA),
            groupLanding: this.ajv.compile(GROUP_LANDING_SCHEMA),
        };
    }

    private ajvIssues(
        errors: ErrorObject[] | null | undefined,
        base: string,
        code: string,
        nodeId?: string,
    ): LayoutIssue[] {
        return (errors ?? [])
            .filter((e) => e.keyword !== "if")
            .map((e) => ({
                path: `${base}${e.instancePath}`,
                nodeId,
                code,
                message:
                    e.keyword === "additionalProperties"
                        ? `unknown field "${(e.params as { additionalProperty: string }).additionalProperty}"`
                        : e.keyword === "enum"
                          ? `must be one of: ${(e.params as { allowedValues: unknown[] }).allowedValues.join(", ")}`
                          : (e.message ?? "invalid"),
            }));
    }

    private check(
        name: string,
        value: unknown,
        base: string,
        code: string,
        nodeId?: string,
    ) {
        const fn = this.v[name];
        return fn(value) ? [] : this.ajvIssues(fn.errors, base, code, nodeId);
    }

    // ---------------------------------------------------------------------
    // Layout
    // ---------------------------------------------------------------------

    /** Cheap guard before saving a draft (never blocks on content). */
    assertShape(layout: unknown): LayoutIssue[] {
        if (!layout || typeof layout !== "object" || Array.isArray(layout))
            return [
                {
                    path: "",
                    code: "NOT_AN_OBJECT",
                    message: "layout must be an object",
                },
            ];
        const issues: LayoutIssue[] = [];
        if (!Array.isArray((layout as { sections?: unknown }).sections))
            issues.push({
                path: "/sections",
                code: "SECTIONS_REQUIRED",
                message: "sections must be an array",
            });
        const bytes = Buffer.byteLength(JSON.stringify(layout));
        if (bytes > SDUI_LIMITS.maxBytes)
            issues.push({
                path: "",
                code: "TOO_LARGE",
                message: `layout is ${bytes} bytes (max ${SDUI_LIMITS.maxBytes})`,
            });
        return issues;
    }

    validateStructure(layout: unknown, kind: SduiScreenKind) {
        const errors: LayoutIssue[] = [...this.assertShape(layout)];
        const warnings: LayoutIssue[] = [];
        const ctx: WalkCtx = {
            kind,
            ids: new Set(),
            count: 0,
            components: new Set(),
            versions: [],
            media: [],
            sections: [],
            groups: [],
            screens: [],
        };
        if (errors.some((e) => e.code === "NOT_AN_OBJECT"))
            return this.result(errors, warnings, ctx);
        const l = layout as Record<string, any>;

        if (l.schemaVersion !== SDUI_SCHEMA_VERSION)
            errors.push({
                path: "/schemaVersion",
                code: "SCHEMA_VERSION",
                message: `schemaVersion must be ${SDUI_SCHEMA_VERSION}`,
            });
        for (const k of Object.keys(l))
            if (
                ![
                    "schemaVersion",
                    "appBar",
                    "sections",
                    "bottomBar",
                    "theme",
                    "settings",
                ].includes(k)
            )
                errors.push({
                    path: `/${k}`,
                    code: "UNKNOWN_FIELD",
                    message: `unknown field "${k}"`,
                });
        if (
            l.settings !== undefined &&
            (typeof l.settings !== "object" ||
                Object.keys(l.settings).some(
                    (k) => !["background", "pullToRefresh"].includes(k),
                ))
        )
            errors.push({
                path: "/settings",
                code: "INVALID",
                message: "settings: background, pullToRefresh only",
            });

        if (kind === "SHELL") {
            if (Array.isArray(l.sections) && l.sections.length)
                errors.push({
                    path: "/sections",
                    code: "SHELL_NO_SECTIONS",
                    message:
                        "the app shell has only appBar, bottomBar and theme",
                });
            if (!l.bottomBar)
                errors.push({
                    path: "/bottomBar",
                    code: "BOTTOM_BAR_REQUIRED",
                    message: "the app shell needs bottom tabs",
                });
            if (l.theme !== undefined)
                errors.push(
                    ...this.check("theme", l.theme, "/theme", "INVALID_THEME"),
                );
        } else {
            if (l.bottomBar)
                errors.push({
                    path: "/bottomBar",
                    code: "SLOT_NOT_ALLOWED",
                    message: "bottomBar exists only on the app shell",
                });
            if (l.theme)
                errors.push({
                    path: "/theme",
                    code: "SLOT_NOT_ALLOWED",
                    message: "the theme is set on the app shell",
                });
        }
        if (
            Array.isArray(l.sections) &&
            l.sections.length > SDUI_LIMITS.maxSections
        )
            errors.push({
                path: "/sections",
                code: "TOO_MANY_SECTIONS",
                message: `max ${SDUI_LIMITS.maxSections} sections`,
            });

        if (l.appBar)
            this.node(l.appBar, "/appBar", "appBar", 1, ctx, errors, warnings);
        if (l.bottomBar)
            this.node(
                l.bottomBar,
                "/bottomBar",
                "bottomBar",
                1,
                ctx,
                errors,
                warnings,
            );
        if (Array.isArray(l.sections))
            l.sections.forEach((n: unknown, i: number) =>
                this.node(
                    n,
                    `/sections/${i}`,
                    "body",
                    1,
                    ctx,
                    errors,
                    warnings,
                ),
            );
        if (ctx.count > SDUI_LIMITS.maxNodes)
            errors.push({
                path: "",
                code: "TOO_MANY_NODES",
                message: `${ctx.count} components (max ${SDUI_LIMITS.maxNodes})`,
            });
        return this.result(errors, warnings, ctx);
    }

    /** One library section (a body node; no section_ref inside, so no cycles). */
    validateSectionNode(node: unknown) {
        const r = this.validateStructure(
            { schemaVersion: SDUI_SCHEMA_VERSION, sections: [node] },
            "SCREEN",
        );
        const fix = (i: LayoutIssue) => ({
            ...i,
            path: i.path.replace(/^\/sections\/0/, "/node"),
        });
        if ((node as SduiNode)?.type === "section_ref")
            r.errors.push({
                path: "/node/type",
                code: "REF_IN_SECTION",
                message: "a saved section can't be another saved section",
            });
        return {
            ...r,
            errors: r.errors.map(fix),
            warnings: r.warnings.map(fix),
        };
    }

    private result(
        errors: LayoutIssue[],
        warnings: LayoutIssue[],
        ctx: WalkCtx,
    ) {
        const versions = [...ctx.components]
            .map((t) => COMPONENT_MAP.get(t)?.minAppVersion ?? "1.0.0")
            .concat(ctx.versions);
        const uniq = (refs: Ref[]) =>
            [...new Set(refs.map((r) => r.key))].sort();
        return {
            errors,
            warnings,
            deps: {
                components: [...ctx.components].sort(),
                sectionKeys: uniq(ctx.sections),
                groupKeys: uniq(ctx.groups),
                mediaIds: uniq(ctx.media),
                screenKeys: uniq(ctx.screens),
                minAppVersion: versions.sort(compareVersions).pop() ?? null,
            } as LayoutDeps,
            refs: ctx,
        };
    }

    private node(
        raw: unknown,
        path: string,
        slot: Slot,
        depth: number,
        ctx: WalkCtx,
        errors: LayoutIssue[],
        warnings: LayoutIssue[],
    ) {
        ctx.count++;
        if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
            errors.push({
                path,
                code: "NOT_AN_OBJECT",
                message: "section must be an object",
            });
            return;
        }
        const n = raw as SduiNode & Record<string, any>;
        const nodeId = typeof n.id === "string" ? n.id : undefined;
        const err = (p: string, code: string, message: string) =>
            errors.push({ path: `${path}${p}`, nodeId, code, message });

        if (!nodeId || !NODE_ID_PATTERN.test(nodeId))
            err("/id", "INVALID_ID", "id must match ^[A-Za-z0-9_-]{1,40}$");
        else if (ctx.ids.has(nodeId))
            err("/id", "DUPLICATE_ID", `id "${nodeId}" is used twice`);
        else ctx.ids.add(nodeId);
        for (const k of Object.keys(n))
            if (!NODE_FIELDS.includes(k))
                err(`/${k}`, "UNKNOWN_FIELD", `unknown field "${k}"`);

        const def: ComponentDef | undefined = COMPONENT_MAP.get(n.type);
        if (!def)
            return err(
                "/type",
                "UNKNOWN_COMPONENT",
                `unknown section type "${n.type}"`,
            );
        ctx.components.add(def.type);
        if (!def.slots.includes(slot))
            err(
                "/type",
                "SLOT_NOT_ALLOWED",
                `${def.type} can't be placed in ${slot}`,
            );
        const kinds = def.kinds ?? ["SCREEN", "PAGE", "TEMPLATE"];
        if (!kinds.includes(ctx.kind))
            err(
                "/type",
                "KIND_NOT_ALLOWED",
                `${def.type} can't be used on a ${ctx.kind} screen`,
            );
        if (depth > SDUI_LIMITS.maxDepth)
            err("", "TOO_DEEP", `nested deeper than ${SDUI_LIMITS.maxDepth}`);

        // variant (design choice)
        if (n.variant !== undefined) {
            const variant = def.variants.find((x) => x.key === n.variant);
            if (!variant)
                err(
                    "/variant",
                    "UNKNOWN_VARIANT",
                    `${def.type} designs: ${def.variants.map((x) => x.key).join(", ")}`,
                );
            else if (variant.minAppVersion)
                ctx.versions.push(variant.minAppVersion);
        }

        // saved section
        if (def.type === "section_ref") {
            if (depth > 1)
                err(
                    "",
                    "REF_NOT_TOP_LEVEL",
                    "saved sections can only be placed at the top level",
                );
            if (typeof n.ref !== "string" || !n.ref)
                err("/ref", "REF_REQUIRED", "choose a saved section");
            else ctx.sections.push({ key: n.ref, path: `${path}/ref`, nodeId });
            for (const k of [
                "header",
                "layout",
                "style",
                "props",
                "source",
                "items",
                "children",
                "action",
            ])
                if (n[k] !== undefined)
                    err(
                        `/${k}`,
                        "REF_ONLY",
                        "a saved section only takes ref and visibility",
                    );
            if (n.visibility !== undefined)
                errors.push(
                    ...this.check(
                        "visibility",
                        n.visibility,
                        `${path}/visibility`,
                        "INVALID_VISIBILITY",
                        nodeId,
                    ),
                );
            return;
        }
        if (n.ref !== undefined)
            err("/ref", "UNKNOWN_FIELD", "ref is only for saved sections");

        const blocks: [string, boolean, string, JsonSchema][] = [
            ["header", !!def.header, "INVALID_HEADER", HEADER_SCHEMA],
            ["layout", !!def.layout, "INVALID_LAYOUT", LAYOUT_SCHEMA],
            ["style", !!def.style, "INVALID_STYLE", STYLE_SCHEMA],
        ];
        for (const [field, allowed, code, schema] of blocks) {
            if (n[field] === undefined) continue;
            if (!allowed) {
                err(`/${field}`, "NOT_ALLOWED", `${def.type} has no ${field}`);
                continue;
            }
            errors.push(
                ...this.check(
                    field,
                    n[field],
                    `${path}/${field}`,
                    code,
                    nodeId,
                ),
            );
            this.collect(n[field], schema, `${path}/${field}`, nodeId, ctx);
        }
        // columns × rows limits per type
        if (def.layout && n.layout && typeof n.layout === "object") {
            const { columns, rows, scroll } = n.layout as {
                columns?: number;
                rows?: number;
                scroll?: string;
            };
            if (
                columns !== undefined &&
                def.layout.columns &&
                (columns < def.layout.columns[0] ||
                    columns > def.layout.columns[1])
            )
                err(
                    "/layout/columns",
                    "COLUMNS_RANGE",
                    `${def.type}: ${def.layout.columns[0]}–${def.layout.columns[1]} columns`,
                );
            if (columns !== undefined && !def.layout.columns)
                err(
                    "/layout/columns",
                    "NOT_ALLOWED",
                    `${def.type} has no columns`,
                );
            if (
                rows !== undefined &&
                def.layout.rows &&
                (rows < def.layout.rows[0] || rows > def.layout.rows[1])
            )
                err(
                    "/layout/rows",
                    "ROWS_RANGE",
                    `${def.type}: ${def.layout.rows[0]}–${def.layout.rows[1]} rows`,
                );
            if (rows !== undefined && !def.layout.rows)
                err("/layout/rows", "NOT_ALLOWED", `${def.type} has no rows`);
            if (
                scroll !== undefined &&
                def.layout.scroll &&
                !def.layout.scroll.includes(scroll)
            )
                err(
                    "/layout/scroll",
                    "SCROLL_NOT_ALLOWED",
                    `${def.type} scroll: ${def.layout.scroll.join(", ")}`,
                );
        }

        // props
        if (n.props !== undefined || def.propsSchema?.required) {
            const fn = this.propsV.get(def.type);
            if (!fn) err("/props", "NOT_ALLOWED", `${def.type} has no options`);
            else if (!fn(n.props ?? {}))
                errors.push(
                    ...this.ajvIssues(
                        fn.errors,
                        `${path}/props`,
                        "INVALID_PROPS",
                        nodeId,
                    ),
                );
            else
                this.collect(
                    n.props,
                    def.propsSchema,
                    `${path}/props`,
                    nodeId,
                    ctx,
                );
        }

        // static items
        if (n.items !== undefined || (def.items && def.items.min > 0)) {
            const fn = this.itemsV.get(def.type);
            if (!fn)
                err(
                    "/items",
                    "NOT_ALLOWED",
                    `${def.type} takes no static items (it uses a data source)`,
                );
            else if (!fn(n.items ?? []))
                errors.push(
                    ...this.ajvIssues(
                        fn.errors,
                        `${path}/items`,
                        "INVALID_ITEMS",
                        nodeId,
                    ),
                );
            else
                this.collect(
                    n.items,
                    { type: "array", items: def.items!.schema },
                    `${path}/items`,
                    nodeId,
                    ctx,
                );
        }

        // data source
        if (n.source !== undefined) {
            const s = n.source as Record<string, unknown>;
            const sdef = SOURCE_MAP.get(String(s?.type));
            if (!def.sources?.includes(String(s?.type)))
                err(
                    "/source/type",
                    "SOURCE_NOT_ALLOWED",
                    `${def.type} can use: ${(def.sources ?? []).join(", ") || "no data source"}`,
                );
            else if (sdef?.templateOnly && ctx.kind !== "TEMPLATE")
                err(
                    "/source/type",
                    "TEMPLATE_ONLY",
                    `"${s.type}" works only on landing templates`,
                );
            else {
                const fn = this.sourceV.get(String(s.type))!;
                if (!fn(s))
                    errors.push(
                        ...this.ajvIssues(
                            fn.errors,
                            `${path}/source`,
                            "INVALID_SOURCE",
                            nodeId,
                        ),
                    );
                if (s.type === "group" && typeof s.key === "string")
                    ctx.groups.push({
                        key: s.key,
                        path: `${path}/source/key`,
                        nodeId,
                    });
                if (s.type === "groups" && Array.isArray(s.keys))
                    (s.keys as string[]).forEach((k, i) =>
                        ctx.groups.push({
                            key: k,
                            path: `${path}/source/keys/${i}`,
                            nodeId,
                        }),
                    );
                if (sdef?.needsLogin && !n.visibility?.loggedIn)
                    warnings.push({
                        path: `${path}/source`,
                        nodeId,
                        code: "LOGIN_ONLY",
                        message:
                            "empty for guests: set visibility.loggedIn = true",
                    });
            }
        } else if (def.sourceRequired)
            err(
                "/source",
                "SOURCE_REQUIRED",
                `${def.type} needs a data source`,
            );

        // section tap action
        if (n.action !== undefined) {
            if (!def.actionable)
                err(
                    "/action",
                    "ACTION_NOT_ALLOWED",
                    `${def.type} has no tap action`,
                );
            else if (!this.v.action(n.action))
                errors.push(
                    ...this.ajvIssues(
                        this.v.action.errors,
                        `${path}/action`,
                        "INVALID_ACTION",
                        nodeId,
                    ),
                );
            else
                this.collect(
                    n.action,
                    { $ref: "sdui://action" },
                    `${path}/action`,
                    nodeId,
                    ctx,
                );
        }

        if (n.visibility !== undefined) {
            errors.push(
                ...this.check(
                    "visibility",
                    n.visibility,
                    `${path}/visibility`,
                    "INVALID_VISIBILITY",
                    nodeId,
                ),
            );
            const vis = n.visibility as { from?: string; to?: string };
            if (vis?.from && vis?.to && vis.from >= vis.to)
                err(
                    "/visibility/to",
                    "INVALID_WINDOW",
                    "to must be after from",
                );
        }
        if (
            n.lazy !== undefined &&
            (typeof n.lazy !== "boolean" || (n.lazy && !def.lazyable))
        )
            err("/lazy", "LAZY_NOT_ALLOWED", `${def.type} can't load lazily`);

        // container children
        if (n.children !== undefined) {
            if (!def.children)
                err(
                    "/children",
                    "CHILDREN_NOT_ALLOWED",
                    `${def.type} has no children`,
                );
            else if (!Array.isArray(n.children))
                err("/children", "INVALID", "children must be an array");
            else {
                if (def.maxChildren && n.children.length > def.maxChildren)
                    err(
                        "/children",
                        "TOO_MANY_CHILDREN",
                        `max ${def.maxChildren}`,
                    );
                n.children.forEach((c, i) => {
                    const t = (c as SduiNode)?.type;
                    if (t === "section_ref" || t === "container")
                        errors.push({
                            path: `${path}/children/${i}/type`,
                            nodeId: (c as SduiNode)?.id,
                            code: "CHILD_NOT_ALLOWED",
                            message: `${t} can't be inside a container`,
                        });
                    else if (
                        Array.isArray(def.children) &&
                        !def.children.includes(t)
                    )
                        errors.push({
                            path: `${path}/children/${i}/type`,
                            nodeId: (c as SduiNode)?.id,
                            code: "CHILD_NOT_ALLOWED",
                            message: `${t} can't be inside ${def.type}`,
                        });
                    this.node(
                        c,
                        `${path}/children/${i}`,
                        "body",
                        depth + 1,
                        ctx,
                        errors,
                        warnings,
                    );
                });
                if (!n.children.length)
                    warnings.push({
                        path: `${path}/children`,
                        nodeId,
                        code: "EMPTY_CONTAINER",
                        message: "empty container is not shown",
                    });
            }
        }

        // bottom tabs link to screens
        if (def.type === "bottom_nav")
            ((n.props?.tabs as { screen?: string }[]) ?? []).forEach(
                (t, i) =>
                    t?.screen &&
                    ctx.screens.push({
                        key: t.screen,
                        path: `${path}/props/tabs/${i}/screen`,
                        nodeId,
                    }),
            );
    }

    /** Media refs + action targets inside a block. */
    private collect(
        value: unknown,
        schema: JsonSchema | undefined,
        path: string,
        nodeId: string | undefined,
        ctx: WalkCtx,
    ) {
        walkSchema(value, schema, path, (kind, v, p, s) => {
            if (kind === "media" && v?.mediaId)
                ctx.media.push({
                    key: String(v.mediaId),
                    kinds: s["x-media"] as string[],
                    path: p,
                    nodeId,
                });
            if (kind === "action") {
                if (v?.type === "navigate" && typeof v.screen === "string")
                    ctx.screens.push({
                        key: v.screen,
                        path: `${p}/screen`,
                        nodeId,
                    });
                if (v?.type === "open_group" && typeof v.key === "string")
                    ctx.groups.push({ key: v.key, path: `${p}/key`, nodeId });
            }
        });
    }

    /** Structure + references (what Publish runs). */
    async validateLayout(
        layout: unknown,
        kind: SduiScreenKind,
        opts: { selfKey?: string } = {},
    ): Promise<ValidationResult> {
        const r = this.validateStructure(layout, kind);
        const errors = [...r.errors];
        const warnings = [...r.warnings];
        await this.checkRefs(r.refs, errors, warnings, opts.selfKey);
        return { errors, warnings, deps: r.deps };
    }

    async checkRefs(
        refs: Pick<WalkCtx, "sections" | "groups" | "media" | "screens">,
        errors: LayoutIssue[],
        warnings: LayoutIssue[],
        selfKey?: string,
    ) {
        const keys = (x: Ref[]) => [...new Set(x.map((r) => r.key))];
        const [sections, groups, media, screens] = await Promise.all([
            this.prisma.sduiSection.findMany({
                where: { key: { in: keys(refs.sections) }, deletedAt: null },
                select: { key: true, isActive: true },
            }),
            this.prisma.sduiGroup.findMany({
                where: { key: { in: keys(refs.groups) }, deletedAt: null },
                select: { key: true, isActive: true },
            }),
            this.prisma.mediaFile.findMany({
                where: { id: { in: keys(refs.media).map(BigInt) } },
                select: {
                    id: true,
                    type: true,
                    status: true,
                    isPrivate: true,
                    deletedAt: true,
                    purpose: true,
                },
            }),
            this.prisma.sduiScreen.findMany({
                where: { key: { in: keys(refs.screens) }, deletedAt: null },
                select: { key: true },
            }),
        ]);
        const byKey = <T extends { key: string }>(rows: T[]) =>
            new Map(rows.map((x) => [x.key, x]));
        const sec = byKey(sections);
        for (const ref of refs.sections) {
            const s = sec.get(ref.key);
            if (!s)
                errors.push({
                    path: ref.path,
                    nodeId: ref.nodeId,
                    code: "SECTION_NOT_FOUND",
                    message: `saved section "${ref.key}" doesn't exist`,
                });
            else if (!s.isActive)
                warnings.push({
                    path: ref.path,
                    nodeId: ref.nodeId,
                    code: "SECTION_INACTIVE",
                    message: `saved section "${ref.key}" is off (not shown)`,
                });
        }
        const grp = byKey(groups);
        for (const ref of refs.groups) {
            const g = grp.get(ref.key);
            if (!g)
                errors.push({
                    path: ref.path,
                    nodeId: ref.nodeId,
                    code: "GROUP_NOT_FOUND",
                    message: `custom group "${ref.key}" doesn't exist`,
                });
            else if (!g.isActive)
                warnings.push({
                    path: ref.path,
                    nodeId: ref.nodeId,
                    code: "GROUP_INACTIVE",
                    message: `custom group "${ref.key}" is off (shows nothing)`,
                });
        }
        const med = new Map(media.map((m) => [m.id.toString(), m]));
        for (const ref of refs.media) {
            const m = med.get(ref.key);
            const type =
                m?.type === MediaType.VIDEO
                    ? "video"
                    : m?.type === MediaType.IMAGE
                      ? "image"
                      : "other";
            const why =
                !m || m.deletedAt
                    ? "doesn't exist"
                    : m.status !== MediaStatus.READY
                      ? `is ${m.status.toLowerCase()} (wait until it's READY)`
                      : m.isPrivate ||
                          !LAYOUT_MEDIA_PURPOSES.includes(m.purpose)
                        ? `is a private / ${m.purpose} file (upload with purpose BANNER)`
                        : !ref.kinds.includes(type)
                          ? `is ${type}, expected ${ref.kinds.join(" or ")}`
                          : null;
            if (why)
                errors.push({
                    path: ref.path,
                    nodeId: ref.nodeId,
                    code: "MEDIA_INVALID",
                    message: `media ${ref.key} ${why}`,
                });
        }
        const scr = new Set(screens.map((s) => s.key));
        for (const ref of refs.screens)
            if (!scr.has(ref.key) && ref.key !== selfKey)
                warnings.push({
                    path: ref.path,
                    nodeId: ref.nodeId,
                    code: "SCREEN_NOT_FOUND",
                    message: `screen "${ref.key}" doesn't exist yet`,
                });
    }

    // ---------------------------------------------------------------------
    // Rules, custom groups
    // ---------------------------------------------------------------------

    conditionsIssues(value: unknown): LayoutIssue[] {
        const issues = this.check(
            "conditions",
            value,
            "/conditions",
            "INVALID_CONDITIONS",
        );
        const ab = (value as { abBucket?: { from: number; to: number } })
            ?.abBucket;
        if (ab && ab.from > ab.to)
            issues.push({
                path: "/conditions/abBucket",
                code: "INVALID_CONDITIONS",
                message: "from must be ≤ to",
            });
        return issues;
    }

    /** One data source on its own (designer "test this source"). */
    sourceIssues(value: unknown): LayoutIssue[] {
        const fn = this.sourceV.get(
            String((value as { type?: unknown })?.type),
        );
        if (!fn)
            return [
                {
                    path: "/source/type",
                    code: "UNKNOWN_SOURCE",
                    message: `must be one of: ${[...this.sourceV.keys()].join(", ")}`,
                },
            ];
        return fn(value)
            ? []
            : this.ajvIssues(fn.errors, "/source", "INVALID_SOURCE");
    }

    /** Structure of a custom group's JSON columns; media refs are returned for the DB check. */
    groupIssues(g: {
        items?: unknown;
        rule?: unknown;
        schedule?: unknown;
        media?: unknown;
        landing?: unknown;
    }) {
        const issues: LayoutIssue[] = [
            ...(g.items !== undefined
                ? this.check("groupItems", g.items, "/items", "INVALID_ITEMS")
                : []),
            ...(g.rule !== undefined && g.rule !== null
                ? this.check("groupRule", g.rule, "/rule", "INVALID_RULE")
                : []),
            ...(g.schedule !== undefined && g.schedule !== null
                ? this.check(
                      "groupSchedule",
                      g.schedule,
                      "/schedule",
                      "INVALID_SCHEDULE",
                  )
                : []),
            ...(g.media !== undefined && g.media !== null
                ? this.check("groupMedia", g.media, "/media", "INVALID_MEDIA")
                : []),
            ...(g.landing !== undefined && g.landing !== null
                ? this.check(
                      "groupLanding",
                      g.landing,
                      "/landing",
                      "INVALID_LANDING",
                  )
                : []),
        ];
        const s = g.schedule as
            | { from?: string; to?: string; startsAt?: string; endsAt?: string }
            | null
            | undefined;
        if (s && !!s.from !== !!s.to)
            issues.push({
                path: "/schedule",
                code: "INVALID_SCHEDULE",
                message: "set both from and to",
            });
        if (s?.startsAt && s?.endsAt && s.startsAt >= s.endsAt)
            issues.push({
                path: "/schedule/endsAt",
                code: "INVALID_SCHEDULE",
                message: "endsAt must be after startsAt",
            });
        const media: MediaRef[] = [];
        walkSchema(
            g.media,
            GROUP_MEDIA_SCHEMA,
            "/media",
            (k, v, p, sch) =>
                k === "media" &&
                v?.mediaId &&
                media.push({
                    key: String(v.mediaId),
                    kinds: sch["x-media"] as string[],
                    path: p,
                }),
        );
        return { issues, media };
    }
}
