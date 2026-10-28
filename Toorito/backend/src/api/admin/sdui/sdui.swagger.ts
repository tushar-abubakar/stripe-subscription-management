/** Swagger docs (with sample requests / responses) for the SDUI designer API: /admin/sdui/*. */
import { causes, errorSchema, IdParam } from "@common/swagger/swagger.util";
import { applyDecorators } from "@nestjs/common";
import {
    ApiBadRequestResponse,
    ApiBody,
    ApiConflictResponse,
    ApiNotFoundResponse,
    ApiOkResponse,
    ApiOperation,
    ApiParam,
} from "@nestjs/swagger";
import {
    CreateGroupDto,
    CreateScreenDto,
    CreateSectionDto,
    DataPreviewDto,
    PreviewDto,
    PublishDto,
    RuleDto,
    SaveDraftDto,
    UpdateGroupDto,
    UpdateRuleDto,
    UpdateScreenDto,
    UpdateSectionDto,
    ValidateDto,
} from "./sdui.dto";

// ─── sample data ─────────────────────────────────────────────────────────

/** A Blinkit-style home: search, banners, categories 4×2, custom group tiles, late-night sale, bestsellers, newly added, themed container. */
export const HOME_LAYOUT = {
    schemaVersion: 1,
    appBar: {
        id: "app_bar",
        type: "search_bar",
        variant: "rounded",
        props: {
            hints: [
                { en: 'Search "milk"', bn: '"দুধ" খুঁজুন' },
                { en: 'Search "eggs"', bn: '"ডিম" খুঁজুন' },
            ],
        },
    },
    sections: [
        {
            id: "hero",
            type: "banner_carousel",
            variant: "peek",
            props: { aspectRatio: 2.4, autoPlayMs: 4000, indicator: "dots" },
            items: [
                {
                    image: { mediaId: "9301" },
                    action: { type: "navigate", screen: "page:monsoon-sale" },
                },
                {
                    image: { mediaId: "9302" },
                    action: { type: "open_group", key: "fresh" },
                },
            ],
        },
        {
            id: "cats",
            type: "category_grid",
            variant: "icon_tiles",
            header: {
                title: { en: "Shop by category", bn: "ক্যাটাগরি অনুযায়ী" },
                seeMore: {
                    label: { en: "See all", bn: "সব দেখুন" },
                    action: { type: "navigate", screen: "categories" },
                },
            },
            layout: { columns: 4, rows: 2, scroll: "grid", gap: 8 },
            source: { type: "categories", parentId: "0", limit: 8 },
        },
        {
            id: "stores",
            type: "group_tiles",
            variant: "image_tiles",
            header: { title: { en: "Explore stores", bn: "স্টোর ঘুরে দেখুন" } },
            layout: { columns: 3, rows: 1, scroll: "grid" },
            source: {
                type: "groups",
                keys: ["fresh", "late-night", "newly-added"],
            },
        },
        {
            id: "night",
            type: "flash_sale",
            variant: "dark_night",
            header: {
                title: { en: "Late night sale", bn: "লেট নাইট সেল" },
                subtitle: { en: "Till 5 AM" },
                seeMore: {
                    label: { en: "See all" },
                    action: { type: "open_group", key: "late-night" },
                },
            },
            props: { showTimer: true },
            style: { background: "token:lateNight", textColor: "#FFFFFF" },
            layout: { rows: 1, scroll: "horizontal", peek: 0.15 },
            source: { type: "group", key: "late-night", limit: 10 },
            visibility: { daily: { from: "23:00", to: "05:00" } },
        },
        { id: "best", type: "section_ref", ref: "bestsellers" },
        {
            id: "new",
            type: "product_rail",
            variant: "card_compact",
            header: {
                title: { en: "Newly added", bn: "নতুন এসেছে" },
                badge: { en: "NEW" },
                seeMore: {
                    label: { en: "See all" },
                    action: { type: "open_group", key: "newly-added" },
                },
            },
            layout: { rows: 2, scroll: "horizontal" },
            source: { type: "group", key: "newly-added", limit: 12 },
        },
        {
            id: "monsoon",
            type: "container",
            variant: "tinted",
            header: { title: { en: "Monsoon store", bn: "বর্ষার স্টোর" } },
            style: { background: "token:surfaceInfo", cornerRadius: 16 },
            layout: { columns: 1, scroll: "none" },
            children: [
                {
                    id: "monsoon_banner",
                    type: "banner",
                    variant: "rounded",
                    items: [
                        {
                            image: { mediaId: "9305" },
                            action: { type: "open_group", key: "monsoon" },
                        },
                    ],
                },
                {
                    id: "monsoon_rail",
                    type: "product_rail",
                    variant: "card_standard",
                    layout: { rows: 1, scroll: "horizontal" },
                    source: { type: "group", key: "monsoon", limit: 10 },
                },
            ],
            visibility: {
                from: "2026-07-01T00:00:00+06:00",
                to: "2026-09-30T23:59:59+06:00",
            },
        },
        {
            id: "again",
            type: "product_rail",
            variant: "card_standard",
            header: { title: { en: "Buy again", bn: "আবার কিনুন" } },
            layout: { rows: 1, scroll: "horizontal" },
            source: { type: "reorder", limit: 12 },
            visibility: { loggedIn: true },
        },
        {
            id: "all",
            type: "product_grid",
            variant: "card_standard",
            header: { title: { en: "All products" } },
            layout: { columns: 2, scroll: "vertical" },
            source: { type: "products", sort: "new", limit: 20 },
            lazy: true,
        },
    ],
};

/** What opens when a custom group is tapped (group_landing template). */
export const GROUP_LANDING_LAYOUT = {
    schemaVersion: 1,
    sections: [
        {
            id: "header",
            type: "entity_header",
            variant: "banner_large",
            props: { showItemCount: true, showTimer: true },
        },
        { id: "filters", type: "filter_bar", variant: "chips" },
        {
            id: "items",
            type: "product_grid",
            variant: "card_standard",
            layout: { columns: 3, scroll: "vertical" },
            source: { type: "entity", limit: 24 },
        },
    ],
};

const VERSION = {
    id: "31",
    version: 8,
    status: "PUBLISHED",
    checksum: "4be1c0…",
    minAppVersion: "1.0.0",
    sectionKeys: ["bestsellers"],
    groupKeys: ["fresh", "late-night", "monsoon", "newly-added"],
    note: "Monsoon block + late night sale",
    publishAt: null,
    publishedAt: "2026-10-24T05:00:00.000Z",
    publishedById: "1",
    createdAt: "2026-10-24T05:00:00.000Z",
};

const SCREEN = {
    id: "2",
    key: "home",
    kind: "SCREEN",
    title: { en: "Home", bn: "হোম" },
    description: { en: "First tab" },
    isSystem: true,
    isActive: true,
    liveVersionId: "31",
    draftLayout: HOME_LAYOUT,
    draftRevision: 14,
    draftUpdatedById: "1",
    draftUpdatedAt: "2026-10-24T05:10:00.000Z",
    rules: [],
    createdById: null,
    createdAt: "2026-10-20T00:00:00.000Z",
    updatedAt: "2026-10-24T05:10:00.000Z",
    deletedAt: null,
    liveVersion: VERSION,
    scheduled: [],
    usedAsLandingBy: [],
    hasUnpublishedChanges: true,
    draftIssues: { errors: [], warnings: [] },
};

const ISSUES_EXAMPLE = {
    statusCode: 400,
    code: "SDUI_INVALID",
    message: "The layout has 3 problem(s)",
    errors: [
        {
            path: "/sections/1/layout/columns",
            nodeId: "cats",
            code: "COLUMNS_RANGE",
            message: "category_grid: 3–5 columns",
        },
        {
            path: "/sections/0/items/0/image",
            nodeId: "hero",
            code: "MEDIA_INVALID",
            message: "media 9301 is processing (wait until it's READY)",
        },
        {
            path: "/sections/3/source/key",
            nodeId: "night",
            code: "GROUP_NOT_FOUND",
            message: 'custom group "late-night" doesn\'t exist',
        },
    ],
    warnings: [
        {
            path: "/sections/7/source",
            nodeId: "again",
            code: "LOGIN_ONLY",
            message: "empty for guests: set visibility.loggedIn = true",
        },
    ],
};

// ─── shared responses ────────────────────────────────────────────────────

export const SCREEN_ID = IdParam("id", "Screen ID", "2");
const VERSION_PARAM = ApiParam({
    name: "version",
    description: "Version number",
    example: 8,
    schema: { type: "integer", minimum: 1 },
});
const RULE_ID = ApiParam({
    name: "ruleId",
    description: "Rule id",
    example: "a1b2c3d4e5f6",
});
const NOT_FOUND = (what: string, code: string) =>
    ApiNotFoundResponse({
        description: `${what} not found`,
        schema: errorSchema(404, "Not Found", `${what} not found`, code),
    });
const INVALID = ApiBadRequestResponse({
    description:
        "Invalid (code SDUI_INVALID): `errors[]` with a JSON-pointer `path`, `nodeId` and `code` for the designer to highlight; `warnings[]` don't block.",
    schema: { example: ISSUES_EXAMPLE },
});
const KEY_TAKEN = ApiConflictResponse({
    description: "Key in use (KEY_TAKEN)",
    schema: errorSchema(
        409,
        "Conflict",
        'Key "fresh" is already used',
        "KEY_TAKEN",
    ),
});

// ─── registry ────────────────────────────────────────────────────────────

export const ApiComponents = () =>
    applyDecorators(
        ApiOperation({
            summary: "Component registry (palette, design variants, forms)",
            description:
                "Everything the designer is built from:\n" +
                "- `components[]`: type, label, category, icon, allowed slots and screen kinds, **variants** (design choices), whether it takes a header / layout (column & row limits, scroll modes) / style, " +
                "`propsSchema`, allowed data `sources`, static `items` schema, children, `minAppVersion`, `defaults` to drop on the canvas;\n" +
                "- `blocks`: JSON Schemas of header, layout, style, visibility;\n" +
                "- `actions[]`, `sources[]`, `conditionsSchema` (targeting), group schemas (items, rule, schedule, media, landing), `themeSchema`, `limits`.\n\n" +
                '`x-localized: true` = language map; `x-media` = `{ "mediaId": "…" }` (upload with POST /account/media, purpose BANNER). Cache by `registryChecksum`.',
        }),
        ApiOkResponse({
            schema: {
                example: {
                    schemaVersion: 1,
                    registryChecksum: "6c1f0e2a9b7d4c11",
                    limits: {
                        maxSections: 60,
                        maxNodes: 300,
                        maxDepth: 3,
                        maxBytes: 262144,
                        maxItems: 50,
                    },
                    components: [
                        {
                            type: "product_rail",
                            label: { en: "Product rail" },
                            category: "commerce",
                            icon: "view_week",
                            slots: ["body"],
                            variants: [
                                {
                                    key: "card_standard",
                                    label: { en: "Standard card" },
                                },
                                {
                                    key: "card_compact",
                                    label: { en: "Compact card" },
                                },
                                {
                                    key: "card_large",
                                    label: { en: "Large card" },
                                },
                                { key: "list_row", label: { en: "List row" } },
                            ],
                            header: true,
                            layout: {
                                columns: [2, 4],
                                rows: [1, 3],
                                scroll: ["horizontal", "grid"],
                            },
                            style: true,
                            sources: [
                                "products",
                                "group",
                                "flash_sale",
                                "reorder",
                                "entity",
                            ],
                            sourceRequired: true,
                            lazyable: true,
                            minAppVersion: "1.0.0",
                            propsSchema: {
                                type: "object",
                                properties: {
                                    showAddButton: {
                                        type: "boolean",
                                        default: true,
                                    },
                                },
                            },
                            defaults: {
                                type: "product_rail",
                                variant: "card_standard",
                                layout: { rows: 1, scroll: "horizontal" },
                                source: {
                                    type: "products",
                                    sort: "bestselling",
                                    limit: 12,
                                },
                            },
                        },
                    ],
                    blocks: {
                        header: { "…": "JSON Schema" },
                        layout: { "…": "JSON Schema" },
                        style: { "…": "JSON Schema" },
                        visibility: { "…": "JSON Schema" },
                    },
                    actions: [
                        {
                            type: "open_group",
                            label: { en: "Open a custom group" },
                            schema: { "…": "…" },
                        },
                    ],
                    sources: [
                        {
                            type: "group",
                            label: { en: "Custom group" },
                            itemKind: "mixed",
                            schema: { "…": "…" },
                        },
                    ],
                },
            },
        }),
    );

// ─── screens ─────────────────────────────────────────────────────────────

export const ApiScreenList = () =>
    applyDecorators(
        ApiOperation({
            summary: "Screens",
            description:
                "Filters: `q` (key / title in any language), `kind`, `state` = live | never_published | unpublished_changes | scheduled | inactive.",
        }),
        ApiOkResponse({
            schema: {
                example: {
                    items: [
                        {
                            ...SCREEN,
                            draftLayout: undefined,
                            nextScheduled: null,
                            activeRules: 1,
                            usedAsLandingBy: 0,
                        },
                        {
                            id: "4",
                            key: "group_landing",
                            kind: "TEMPLATE",
                            title: { en: "Custom group page" },
                            isSystem: true,
                            isActive: true,
                            liveVersionId: "12",
                            liveVersion: { ...VERSION, id: "12", version: 2 },
                            nextScheduled: null,
                            activeRules: 0,
                            usedAsLandingBy: 5,
                            hasUnpublishedChanges: false,
                        },
                    ],
                    total: 9,
                    page: 1,
                    limit: 20,
                },
            },
        }),
    );

export const ApiScreenGet = () =>
    applyDecorators(
        ApiOperation({
            summary: "One screen (what the designer opens)",
            description:
                "Draft + structural `draftIssues`, live version, scheduled versions, rules, and the custom groups that open with this screen.",
        }),
        SCREEN_ID,
        ApiOkResponse({ schema: { example: SCREEN } }),
        NOT_FOUND("Screen", "SCREEN_NOT_FOUND"),
    );

export const ApiScreenCreate = () =>
    applyDecorators(
        ApiOperation({
            summary: "Create a screen",
            description:
                "SCREEN (tab / page), PAGE (campaign: key `page:…`), TEMPLATE (what opens when something is tapped, e.g. `group_landing:fresh` for one custom group). " +
                "Templates start with a header + filters + products design. System screens already exist: shell, home, categories, group_landing, category_landing, brand_landing, pdp, cart_empty.",
        }),
        ApiBody({
            type: CreateScreenDto,
            examples: {
                page: {
                    summary: "Campaign page",
                    value: {
                        key: "page:monsoon-sale",
                        kind: "PAGE",
                        title: { en: "Monsoon sale", bn: "বর্ষার সেল" },
                    },
                },
                landing: {
                    summary: "Own landing design for one group",
                    value: {
                        key: "group_landing:late-night",
                        kind: "TEMPLATE",
                        title: { en: "Late night store" },
                    },
                },
                copy: {
                    summary: "Copy of home v8",
                    value: {
                        key: "home_eid",
                        kind: "SCREEN",
                        title: { en: "Home (Eid)" },
                        copyFromScreenId: 2,
                        copyFromVersion: 8,
                    },
                },
            },
        }),
        ApiOkResponse({
            schema: {
                example: {
                    ...SCREEN,
                    id: "12",
                    key: "group_landing:late-night",
                    kind: "TEMPLATE",
                    title: { en: "Late night store" },
                    isSystem: false,
                    liveVersionId: null,
                    liveVersion: null,
                    draftLayout: GROUP_LANDING_LAYOUT,
                    draftRevision: 0,
                },
            },
        }),
        ApiBadRequestResponse({
            description: causes("Invalid", [
                "Bad key (INVALID_KEY)",
                "PAGE key without page: (PAGE_KEY_PREFIX)",
                "Second shell (SHELL_EXISTS)",
            ]),
            schema: errorSchema(
                400,
                "Bad Request",
                'Campaign page keys start with "page:"',
                "PAGE_KEY_PREFIX",
            ),
        }),
        KEY_TAKEN,
    );

export const ApiScreenUpdate = () =>
    applyDecorators(
        ApiOperation({
            summary: "Rename / describe / switch a screen on or off",
        }),
        SCREEN_ID,
        ApiBody({ type: UpdateScreenDto }),
        ApiOkResponse({ schema: { example: SCREEN } }),
        NOT_FOUND("Screen", "SCREEN_NOT_FOUND"),
    );

export const ApiScreenDelete = () =>
    applyDecorators(
        ApiOperation({
            summary: "Delete a screen",
            description:
                "Soft delete (key stays reserved). Refused for system screens and for templates that custom groups open (409 LANDING_IN_USE with `groups`).",
        }),
        SCREEN_ID,
        ApiOkResponse({ schema: { example: { success: true } } }),
        ApiConflictResponse({
            description: "LANDING_IN_USE",
            schema: {
                example: {
                    statusCode: 409,
                    code: "LANDING_IN_USE",
                    message: "Custom groups open this screen",
                    groups: ["late-night"],
                },
            },
        }),
        NOT_FOUND("Screen", "SCREEN_NOT_FOUND"),
    );

export const ApiSaveDraft = () =>
    applyDecorators(
        ApiOperation({
            summary: "Autosave the draft",
            description:
                "Send the whole layout and the `revision` you started from. Saved even with content problems (returned in `issues` for the canvas); refused only for a broken shape " +
                "or when someone saved in between (409 DRAFT_CONFLICT with who / when).",
        }),
        SCREEN_ID,
        ApiBody({
            type: SaveDraftDto,
            examples: {
                home: { value: { revision: 14, layout: HOME_LAYOUT } },
                landing: {
                    summary: "Group landing template",
                    value: { revision: 0, layout: GROUP_LANDING_LAYOUT },
                },
            },
        }),
        ApiOkResponse({
            schema: {
                example: {
                    revision: 15,
                    savedAt: "2026-10-24T05:12:00.000Z",
                    checksum: "d03f9a…",
                    issues: {
                        errors: [
                            {
                                path: "/sections/1/layout/columns",
                                nodeId: "cats",
                                code: "COLUMNS_RANGE",
                                message: "category_grid: 3–5 columns",
                            },
                        ],
                        warnings: [],
                    },
                },
            },
        }),
        ApiConflictResponse({
            description: "DRAFT_CONFLICT",
            schema: {
                example: {
                    statusCode: 409,
                    code: "DRAFT_CONFLICT",
                    message:
                        "Someone else saved this in the meantime. Reload and apply your changes again",
                    currentRevision: 15,
                    updatedById: "6",
                    updatedAt: "2026-10-24T05:11:40.000Z",
                },
            },
        }),
        INVALID,
        NOT_FOUND("Screen", "SCREEN_NOT_FOUND"),
    );

export const ApiDiscardDraft = () =>
    applyDecorators(
        ApiOperation({
            summary: "Discard the draft (back to the live layout)",
        }),
        SCREEN_ID,
        ApiOkResponse({ schema: { example: SCREEN } }),
        NOT_FOUND("Screen", "SCREEN_NOT_FOUND"),
    );

export const ApiValidate = () =>
    applyDecorators(
        ApiOperation({
            summary: "Full check (what Publish runs)",
            description:
                "Structure + references: saved sections and custom groups exist, media READY / public / right kind, linked screens exist (warning). Send `layout` to check unsaved canvas content.",
        }),
        SCREEN_ID,
        ApiBody({ type: ValidateDto, required: false }),
        ApiOkResponse({
            schema: {
                example: {
                    valid: true,
                    errors: [],
                    warnings: [],
                    deps: {
                        components: [
                            "banner_carousel",
                            "category_grid",
                            "container",
                            "flash_sale",
                            "group_tiles",
                            "product_grid",
                            "product_rail",
                            "search_bar",
                            "section_ref",
                        ],
                        sectionKeys: ["bestsellers"],
                        groupKeys: [
                            "fresh",
                            "late-night",
                            "monsoon",
                            "newly-added",
                        ],
                        mediaIds: ["9301", "9302", "9305"],
                        screenKeys: ["categories", "page:monsoon-sale"],
                        minAppVersion: "1.0.0",
                    },
                },
            },
        }),
        NOT_FOUND("Screen", "SCREEN_NOT_FOUND"),
    );

export const ApiPublish = () =>
    applyDecorators(
        ApiOperation({
            summary: "Publish the draft",
            description:
                "Requires `sdui.publish`. Runs the full check (400 SDUI_INVALID), then saves an immutable version: live now (default), SCHEDULED (`publishAt` in the future) or a variant for rules (`makeLive: false`). " +
                "409 NOTHING_TO_PUBLISH when the draft equals the live version; 409 DRAFT_CHANGED when `revision` doesn't match.",
        }),
        SCREEN_ID,
        ApiBody({
            type: PublishDto,
            examples: {
                now: { value: { note: "Monsoon block", revision: 15 } },
                schedule: {
                    value: {
                        note: "Eid layout",
                        publishAt: "2026-11-01T00:00:00+06:00",
                    },
                },
                variant: { value: { note: "Variant B", makeLive: false } },
            },
        }),
        ApiOkResponse({
            schema: {
                example: { ...VERSION, version: 9, live: true, warnings: [] },
            },
        }),
        INVALID,
        ApiConflictResponse({
            description: "NOTHING_TO_PUBLISH / DRAFT_CHANGED",
            schema: errorSchema(
                409,
                "Conflict",
                "The draft is the same as the live version",
                "NOTHING_TO_PUBLISH",
            ),
        }),
        NOT_FOUND("Screen", "SCREEN_NOT_FOUND"),
    );

export const ApiVersions = () =>
    applyDecorators(
        ApiOperation({ summary: "Version history (newest first, no layouts)" }),
        SCREEN_ID,
        ApiOkResponse({
            schema: {
                example: {
                    items: [
                        { ...VERSION, isLive: true, usedByRules: false },
                        {
                            ...VERSION,
                            id: "29",
                            version: 7,
                            isLive: false,
                            usedByRules: true,
                            note: "Variant B",
                        },
                    ],
                    total: 8,
                    page: 1,
                    limit: 20,
                },
            },
        }),
        NOT_FOUND("Screen", "SCREEN_NOT_FOUND"),
    );

export const ApiVersionGet = () =>
    applyDecorators(
        ApiOperation({ summary: "One version with its layout" }),
        SCREEN_ID,
        VERSION_PARAM,
        ApiOkResponse({
            schema: {
                example: {
                    ...VERSION,
                    screenId: "2",
                    layout: HOME_LAYOUT,
                    schemaVersion: 1,
                    isLive: true,
                },
            },
        }),
        NOT_FOUND("Version", "VERSION_NOT_FOUND"),
    );

export const ApiDiff = () =>
    applyDecorators(
        ApiOperation({
            summary: "What changed",
            description:
                "Section-level diff of a version against `live`, `draft` or another version: added / removed / moved / changed (fields).",
        }),
        SCREEN_ID,
        VERSION_PARAM,
        ApiOkResponse({
            schema: {
                example: {
                    from: "v7",
                    to: "draft",
                    identical: false,
                    added: [
                        {
                            id: "night",
                            type: "flash_sale",
                            slot: "sections",
                            index: 3,
                        },
                    ],
                    removed: [],
                    moved: [{ id: "best", from: 3, to: 4 }],
                    changed: [
                        {
                            id: "cats",
                            type: "category_grid",
                            fields: ["variant", "layout"],
                        },
                    ],
                    themeChanged: false,
                    settingsChanged: false,
                },
            },
        }),
        NOT_FOUND("Version", "VERSION_NOT_FOUND"),
    );

export const ApiMakeLive = () =>
    applyDecorators(
        ApiOperation({
            summary: "Make a version live (rollback / promote a variant)",
            description: "Requires `sdui.publish`. Re-checks references.",
        }),
        SCREEN_ID,
        VERSION_PARAM,
        ApiOkResponse({ schema: { example: SCREEN } }),
        ApiBadRequestResponse({
            description: "VERSION_NOT_PUBLISHED / SDUI_INVALID",
            schema: errorSchema(
                400,
                "Bad Request",
                "Only published versions can be used",
                "VERSION_NOT_PUBLISHED",
            ),
        }),
        NOT_FOUND("Version", "VERSION_NOT_FOUND"),
    );

export const ApiCancelSchedule = () =>
    applyDecorators(
        ApiOperation({ summary: "Cancel a scheduled version" }),
        SCREEN_ID,
        VERSION_PARAM,
        ApiOkResponse({ schema: { example: { success: true } } }),
        NOT_FOUND("Version", "VERSION_NOT_FOUND"),
    );

export const ApiRestoreDraft = () =>
    applyDecorators(
        ApiOperation({
            summary: "Copy a version into the draft",
            description:
                "Keep working from an older version (nothing goes live).",
        }),
        SCREEN_ID,
        VERSION_PARAM,
        ApiOkResponse({ schema: { example: SCREEN } }),
        NOT_FOUND("Version", "VERSION_NOT_FOUND"),
    );

const RULE = {
    id: "a1b2c3d4e5f6",
    name: "Dhaka · new users · 50%",
    versionId: "33",
    priority: 10,
    isActive: true,
    startsAt: null,
    endsAt: "2026-11-08T00:00:00.000Z",
    conditions: {
        cities: ["Dhaka"],
        segments: ["NEW_CUSTOMER"],
        abBucket: { from: 0, to: 49, salt: "home-nov" },
    },
    createdById: "1",
    updatedAt: "2026-10-24T05:20:00.000Z",
    version: {
        id: "33",
        version: 9,
        status: "PUBLISHED",
        minAppVersion: "1.0.0",
    },
};

export const ApiRules = () =>
    applyDecorators(
        ApiOperation({
            summary: "Targeting / A-B rules",
            description:
                "Lowest `priority` first; the first active rule inside its window whose conditions all match picks its version, otherwise the live one. " +
                "Conditions: storeIds, cities, platforms, appVersion {min,max}, loggedIn, segments (GUEST / NEW_CUSTOMER / REPEAT_CUSTOMER), abBucket {from,to,salt}.",
        }),
        SCREEN_ID,
        ApiOkResponse({ schema: { example: [RULE] } }),
        NOT_FOUND("Screen", "SCREEN_NOT_FOUND"),
    );

export const ApiRuleCreate = () =>
    applyDecorators(
        ApiOperation({
            summary: "Add a rule",
            description:
                "Requires `sdui.publish`. Publish the variant first with `makeLive: false`.",
        }),
        SCREEN_ID,
        ApiBody({
            type: RuleDto,
            examples: {
                ab: {
                    summary: "A/B 50 %",
                    value: {
                        name: "Variant B",
                        version: 9,
                        priority: 10,
                        conditions: {
                            abBucket: { from: 0, to: 49, salt: "home-nov" },
                        },
                    },
                },
                city: {
                    summary: "City + window",
                    value: {
                        name: "Chattogram Eid",
                        version: 10,
                        conditions: { cities: ["Chattogram"] },
                        startsAt: "2026-11-01T00:00:00+06:00",
                        endsAt: "2026-11-05T00:00:00+06:00",
                    },
                },
            },
        }),
        ApiOkResponse({
            description: "All rules of the screen",
            schema: { example: [RULE] },
        }),
        INVALID,
        NOT_FOUND("Version", "VERSION_NOT_FOUND"),
    );

export const ApiRuleUpdate = () =>
    applyDecorators(
        ApiOperation({ summary: "Change a rule" }),
        SCREEN_ID,
        RULE_ID,
        ApiBody({ type: UpdateRuleDto }),
        ApiOkResponse({ schema: { example: [RULE] } }),
        INVALID,
        NOT_FOUND("Rule", "RULE_NOT_FOUND"),
    );

export const ApiRuleDelete = () =>
    applyDecorators(
        ApiOperation({ summary: "Delete a rule" }),
        SCREEN_ID,
        RULE_ID,
        ApiOkResponse({ schema: { example: [] } }),
        NOT_FOUND("Rule", "RULE_NOT_FOUND"),
    );

// ─── saved sections ──────────────────────────────────────────────────────

const SECTION_NODE = {
    id: "bestsellers",
    type: "product_rail",
    variant: "card_standard",
    header: {
        title: { en: "Bestsellers", bn: "বেস্টসেলার" },
        seeMore: {
            label: { en: "See all", bn: "সব দেখুন" },
            action: { type: "open_group", key: "bestsellers" },
        },
    },
    layout: { rows: 1, scroll: "horizontal", peek: 0.2 },
    source: { type: "products", sort: "bestselling", limit: 12 },
};
const SECTION = {
    id: "3",
    key: "bestsellers",
    name: { en: "Bestsellers rail", bn: "বেস্টসেলার" },
    type: "product_rail",
    node: SECTION_NODE,
    isActive: true,
    revision: 2,
    updatedById: "1",
    createdAt: "2026-10-20T00:00:00.000Z",
    updatedAt: "2026-10-24T05:00:00.000Z",
    deletedAt: null,
    usage: {
        blocking: true,
        versions: [
            {
                screenId: "2",
                screenKey: "home",
                screenTitle: { en: "Home" },
                version: 8,
                status: "PUBLISHED",
            },
        ],
        drafts: [{ id: "2", key: "home" }],
    },
};

export const ApiSectionList = () =>
    applyDecorators(
        ApiOperation({
            summary: "Saved sections",
            description: "Filters: `q` (key / name), `type`, `isActive`.",
        }),
        ApiOkResponse({
            schema: {
                example: {
                    items: [{ ...SECTION, usage: undefined }],
                    total: 1,
                    page: 1,
                    limit: 20,
                },
            },
        }),
    );

export const ApiSectionGet = () =>
    applyDecorators(
        ApiOperation({ summary: "One saved section + where it's used" }),
        IdParam("id", "Section ID", "3"),
        ApiOkResponse({ schema: { example: SECTION } }),
        NOT_FOUND("Section", "SECTION_NOT_FOUND"),
    );

export const ApiSectionCreate = () =>
    applyDecorators(
        ApiOperation({
            summary: "Save a section to the library",
            description:
                'Any body section (a `container` with children = a reusable block). Placed with `{ "type": "section_ref", "ref": "<key>" }`.',
        }),
        ApiBody({
            type: CreateSectionDto,
            examples: {
                rail: {
                    value: {
                        key: "bestsellers",
                        name: { en: "Bestsellers rail" },
                        node: SECTION_NODE,
                    },
                },
            },
        }),
        ApiOkResponse({
            schema: {
                example: {
                    ...SECTION,
                    revision: 0,
                    usage: { blocking: false, versions: [], drafts: [] },
                },
            },
        }),
        INVALID,
        KEY_TAKEN,
    );

export const ApiSectionUpdate = () =>
    applyDecorators(
        ApiOperation({
            summary: "Edit a saved section (live everywhere)",
            description:
                "Requires `sdui.publish`. Send the `revision` you loaded (409 SECTION_CONFLICT).",
        }),
        IdParam("id", "Section ID", "3"),
        ApiBody({
            type: UpdateSectionDto,
            examples: {
                variant: {
                    summary: "Switch design",
                    value: {
                        revision: 2,
                        node: { ...SECTION_NODE, variant: "card_large" },
                    },
                },
            },
        }),
        ApiOkResponse({ schema: { example: { ...SECTION, revision: 3 } } }),
        INVALID,
        NOT_FOUND("Section", "SECTION_NOT_FOUND"),
    );

export const ApiSectionDelete = () =>
    applyDecorators(
        ApiOperation({
            summary: "Delete a saved section",
            description:
                "Requires `sdui.publish`. Refused while a live / scheduled / rule version uses it (409 SECTION_IN_USE with `usage`).",
        }),
        IdParam("id", "Section ID", "3"),
        ApiOkResponse({
            schema: { example: { success: true, draftsMentioning: [] } },
        }),
        ApiConflictResponse({
            description: "SECTION_IN_USE",
            schema: {
                example: {
                    statusCode: 409,
                    code: "SECTION_IN_USE",
                    message: "This section is used by a published screen",
                    usage: SECTION.usage,
                },
            },
        }),
        NOT_FOUND("Section", "SECTION_NOT_FOUND"),
    );

// ─── custom groups ───────────────────────────────────────────────────────

const GROUP = {
    id: "5",
    key: "late-night",
    title: { en: "Late night sale", bn: "লেট নাইট সেল" },
    subtitle: { en: "Snacks & drinks till 5 AM" },
    media: { cover: { mediaId: "9310" }, banner: { mediaId: "9311" } },
    kind: "RULE",
    items: [],
    rule: {
        categoryIds: ["12", "14"],
        inStockOnly: true,
        minDiscountPct: 10,
        sort: "discount",
    },
    schedule: { from: "23:00", to: "05:00" },
    landingScreenId: "12",
    landing: {
        header: "gradient",
        filters: ["category", "price"],
        sort: ["discount", "price_asc"],
        layout: { columns: 3, cardVariant: "card_compact" },
        background: "token:lateNight",
    },
    isActive: true,
    updatedById: "1",
    createdAt: "2026-10-20T00:00:00.000Z",
    updatedAt: "2026-10-24T05:00:00.000Z",
    deletedAt: null,
    landingScreen: {
        id: "12",
        key: "group_landing:late-night",
        kind: "TEMPLATE",
        title: { en: "Late night store" },
    },
    usage: {
        blocking: true,
        versions: [
            {
                screenId: "2",
                screenKey: "home",
                screenTitle: { en: "Home" },
                version: 8,
                status: "PUBLISHED",
            },
        ],
        drafts: [{ id: "2", key: "home" }],
    },
};
const MANUAL_GROUP = {
    ...GROUP,
    id: "4",
    key: "fresh",
    title: { en: "Fresh items", bn: "তাজা পণ্য" },
    subtitle: { en: "Picked this morning" },
    kind: "MANUAL",
    rule: null,
    schedule: null,
    landingScreenId: null,
    landingScreen: null,
    landing: { header: "banner_large" },
    items: [
        {
            type: "category",
            id: "21",
            name: "Fruits",
            slug: "fruits",
            showable: true,
        },
        {
            type: "product",
            id: "12",
            name: "Banana (Sagor)",
            slug: "banana-sagor",
            showable: true,
        },
        {
            type: "product",
            id: "45",
            name: "Tomato",
            slug: "tomato",
            showable: false,
        },
    ],
};

export const ApiGroupList = () =>
    applyDecorators(
        ApiOperation({
            summary: "Custom groups",
            description:
                "Filters: `q` (key / title in any language), `kind`, `isActive`. MANUAL = hand-picked items; RULE = filter + sort per store.",
        }),
        ApiOkResponse({
            schema: {
                example: {
                    items: [
                        { ...GROUP, usage: undefined, itemCount: 0 },
                        { ...MANUAL_GROUP, usage: undefined, itemCount: 3 },
                    ],
                    total: 2,
                    page: 1,
                    limit: 20,
                },
            },
        }),
    );

export const ApiGroupGet = () =>
    applyDecorators(
        ApiOperation({
            summary: "One custom group",
            description:
                "MANUAL items come with their name (admin's language), slug and `showable` (false = unpublished / inactive). Plus the landing screen and where the group is used.",
        }),
        IdParam("id", "Group ID", "4"),
        ApiOkResponse({ schema: { example: MANUAL_GROUP } }),
        NOT_FOUND("Group", "GROUP_NOT_FOUND"),
    );

export const ApiGroupCreate = () =>
    applyDecorators(
        ApiOperation({
            summary: "Create a custom group",
            description:
                'Sections show it with `source: { type: "group", key }` (or as a tile with `groups`), and `{ type: "open_group", key }` opens it. ' +
                "`schedule` limits when it's on (late-night sale); `landingScreenId` picks the TEMPLATE / PAGE that opens on tap (null = `group_landing`), `landing` tunes it per group.",
        }),
        ApiBody({
            type: CreateGroupDto,
            examples: {
                fresh: {
                    summary: "Fresh items (hand-picked)",
                    value: {
                        key: "fresh",
                        title: { en: "Fresh items", bn: "তাজা পণ্য" },
                        subtitle: { en: "Picked this morning" },
                        kind: "MANUAL",
                        media: { cover: { mediaId: "9301" } },
                        items: [
                            { type: "category", id: "21" },
                            { type: "product", id: "12" },
                        ],
                        landing: { header: "banner_large" },
                    },
                },
                lateNight: {
                    summary: "Late night sale (rule + schedule + own landing)",
                    value: {
                        key: "late-night",
                        title: { en: "Late night sale", bn: "লেট নাইট সেল" },
                        kind: "RULE",
                        rule: {
                            categoryIds: ["12", "14"],
                            minDiscountPct: 10,
                            sort: "discount",
                        },
                        schedule: { from: "23:00", to: "05:00" },
                        landingScreenId: 12,
                        landing: {
                            header: "gradient",
                            filters: ["category", "price"],
                            layout: { columns: 3 },
                        },
                    },
                },
                newlyAdded: {
                    summary: "Newly added (rule)",
                    value: {
                        key: "newly-added",
                        title: { en: "Newly added", bn: "নতুন এসেছে" },
                        kind: "RULE",
                        rule: { newWithinDays: 7, sort: "new" },
                    },
                },
            },
        }),
        ApiOkResponse({
            schema: {
                example: {
                    ...GROUP,
                    usage: { blocking: false, versions: [], drafts: [] },
                },
            },
        }),
        ApiBadRequestResponse({
            description: causes("Invalid (SDUI_INVALID)", [
                "RULE group without rule (RULE_REQUIRED)",
                "Unknown product / category / brand (ITEM_NOT_FOUND)",
                "Media not READY / not BANNER (MEDIA_INVALID)",
                "Landing screen not TEMPLATE / PAGE (LANDING_KIND)",
                "Schedule from without to (INVALID_SCHEDULE)",
            ]),
            schema: {
                example: {
                    ...ISSUES_EXAMPLE,
                    errors: [
                        {
                            path: "/landingScreenId",
                            code: "LANDING_KIND",
                            message:
                                "the landing screen must be a TEMPLATE or a PAGE",
                        },
                    ],
                },
            },
        }),
        KEY_TAKEN,
    );

export const ApiGroupUpdate = () =>
    applyDecorators(
        ApiOperation({
            summary: "Edit a custom group (live everywhere)",
            description:
                "Requires `sdui.publish`. Send `null` to clear subtitle / media / rule / schedule / landingScreenId / landing.",
        }),
        IdParam("id", "Group ID", "5"),
        ApiBody({
            type: UpdateGroupDto,
            examples: {
                hours: {
                    summary: "Change the hours",
                    value: { schedule: { from: "22:30", to: "04:00" } },
                },
                landing: {
                    summary: "Use the default landing",
                    value: { landingScreenId: null },
                },
            },
        }),
        ApiOkResponse({ schema: { example: GROUP } }),
        INVALID,
        NOT_FOUND("Group", "GROUP_NOT_FOUND"),
    );

export const ApiGroupDelete = () =>
    applyDecorators(
        ApiOperation({
            summary: "Delete a custom group",
            description:
                "Requires `sdui.publish`. Refused while a served version uses it (409 GROUP_IN_USE).",
        }),
        IdParam("id", "Group ID", "5"),
        ApiOkResponse({
            schema: { example: { success: true, draftsMentioning: [] } },
        }),
        ApiConflictResponse({
            description: "GROUP_IN_USE",
            schema: {
                example: {
                    statusCode: 409,
                    code: "GROUP_IN_USE",
                    message: "This custom group is used by a published screen",
                    usage: GROUP.usage,
                },
            },
        }),
        NOT_FOUND("Group", "GROUP_NOT_FOUND"),
    );

// ─── preview ─────────────────────────────────────────────────────────────

export const ApiPreview = () =>
    applyDecorators(
        ApiOperation({
            summary: "Preview the draft like the app draws it",
            description:
                "Renders the saved draft (or `layout`) with a store's live data, as a customer / segment, at a time (`at`), never cached. " +
                "TEMPLATE screens need `entity` (the group / category / brand it opens for). Returns the rendered screen plus a 30-minute `token`: " +
                "show `appPath` as a QR code, the app opens it with GET app/preview/{token}.",
        }),
        SCREEN_ID,
        ApiBody({
            type: PreviewDto,
            examples: {
                night: {
                    summary: "Home at 23:30 as a new customer",
                    value: {
                        storeId: 1,
                        segment: "NEW_CUSTOMER",
                        lang: "bn",
                        at: "2026-10-24T23:30:00+06:00",
                    },
                },
                landing: {
                    summary: "Group landing template for late-night",
                    value: {
                        storeId: 1,
                        entity: { type: "group", ref: "late-night" },
                    },
                },
            },
        }),
        ApiOkResponse({
            schema: {
                example: {
                    token: "x1V3pQ9mT0rKc2bA7yZ5wE1u",
                    expiresAt: "2026-10-24T06:10:00.000Z",
                    appPath: "app/preview/x1V3pQ9mT0rKc2bA7yZ5wE1u",
                    issues: { errors: [], warnings: [] },
                    rendered: {
                        schemaVersion: 1,
                        screen: {
                            key: "home",
                            kind: "SCREEN",
                            title: "হোম",
                            version: null,
                            variant: null,
                            preview: true,
                        },
                        sections: [
                            {
                                id: "night",
                                type: "flash_sale",
                                variant: "dark_night",
                                header: { title: "লেট নাইট সেল" },
                                data: {
                                    items: ["…product cards…"],
                                    next: null,
                                    total: 4,
                                },
                            },
                        ],
                        ttlSec: 20,
                    },
                },
            },
        }),
        NOT_FOUND("Screen", "SCREEN_NOT_FOUND"),
    );

export const ApiDataPreview = () =>
    applyDecorators(
        ApiOperation({
            summary: "Test a data source",
            description:
                'What a section\'s `source` returns for a store right now (inspector "Preview data").',
        }),
        ApiBody({ type: DataPreviewDto }),
        ApiOkResponse({
            schema: {
                example: {
                    items: [
                        {
                            kind: "product",
                            productId: "1",
                            slug: "amul-taaza",
                            title: "Amul Taaza Toned Milk",
                            availability: "AVAILABLE",
                            defaultVariantId: "1",
                            variants: ["…"],
                        },
                    ],
                    next: "eyJvIjo2fQ",
                    total: 23,
                    validUntil: "2026-10-24T23:00:00.000Z",
                },
            },
        }),
        INVALID,
    );
