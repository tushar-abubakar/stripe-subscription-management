/**
 * JSON Schemas for everything a layout can contain (other than component
 * props): building blocks, tap actions, data sources, visibility, targeting,
 * custom-group rules / schedules / landing options and theme tokens.
 * The backend validates with them; the admin panel renders forms from them.
 *
 * Annotations read by the server:
 *  - "x-localized": true → language map {"en": "...", "bn": "..."}
 *  - "x-media": ["image" | "video"] → { "mediaId": "123" } (upload with POST /account/media, purpose BANNER)
 */
import { PLATFORMS, SEGMENTS, WEEKDAYS } from "./contract";

export type JsonSchema = Record<string, unknown>;

// ─── building blocks ─────────────────────────────────────────────────────

export const text = (maxLength = 200): JsonSchema => ({
    type: "object",
    "x-localized": true,
    minProperties: 1,
    propertyNames: { pattern: "^[a-zA-Z]{2}(-[A-Za-z]{2})?$" },
    additionalProperties: { type: "string", maxLength },
    title: "Text per language",
    examples: [{ en: "Fresh items", bn: "তাজা পণ্য" }],
});

export const media = (
    kinds: ("image" | "video")[] = ["image"],
): JsonSchema => ({
    type: "object",
    "x-media": kinds,
    required: ["mediaId"],
    additionalProperties: false,
    properties: { mediaId: { type: "string", pattern: "^[0-9]+$" } },
    title: kinds.includes("video") ? "Image or video" : "Image",
});

export const color: JsonSchema = {
    type: "string",
    pattern: "^(#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?|token:[A-Za-z0-9_.-]{1,40})$",
    description: "#RRGGBB(AA) or a theme token (token:surfaceWarm)",
};
export const ACTION_REF: JsonSchema = { $ref: "sdui://action" };
const time = { type: "string", pattern: "^([01][0-9]|2[0-3]):[0-5][0-9]$" };
const idString = { type: "string", pattern: "^[0-9]+$" };
const idList = (max = 50) => ({
    type: "array",
    items: idString,
    maxItems: max,
    uniqueItems: true,
});
const screenKey = { type: "string", pattern: "^[a-z0-9][a-z0-9_:-]{1,79}$" };
const libraryKey = { type: "string", pattern: "^[a-z0-9][a-z0-9_-]{1,79}$" };
const semver = { type: "string", pattern: "^\\d{1,3}\\.\\d{1,3}\\.\\d{1,4}$" };
const limit = (def: number) => ({
    type: "integer",
    minimum: 1,
    maximum: 50,
    default: def,
});

export const obj = (
    properties: Record<string, JsonSchema>,
    required: string[] = [],
): JsonSchema => ({
    type: "object",
    additionalProperties: false,
    properties,
    required,
});

/** Section title row (name, subtitle, icon, "See all"). */
export const HEADER_SCHEMA = obj({
    title: text(80),
    subtitle: text(120),
    icon: media(["image"]),
    badge: text(20),
    align: { enum: ["start", "center"], default: "start" },
    seeMore: obj(
        {
            label: text(30),
            action: ACTION_REF,
            style: { enum: ["text", "arrow", "button"], default: "text" },
        },
        ["action"],
    ),
});

/** Grid of the section: columns × rows and how it scrolls. */
export const LAYOUT_SCHEMA = obj({
    columns: { type: "integer", minimum: 1, maximum: 5 },
    rows: { type: "integer", minimum: 1, maximum: 10 },
    scroll: {
        enum: ["none", "horizontal", "vertical", "grid"],
        description:
            "horizontal = swipeable rail; grid = columns × rows, no scroll",
    },
    itemAspect: {
        type: "number",
        minimum: 0.3,
        maximum: 4,
        description: "item width / height",
    },
    peek: {
        type: "number",
        minimum: 0,
        maximum: 0.5,
        description: "share of the next item visible on a horizontal rail",
    },
    gap: { type: "integer", minimum: 0, maximum: 32 },
    padding: { type: "integer", minimum: 0, maximum: 32 },
});

export const STYLE_SCHEMA = obj({
    background: color,
    backgroundImage: media(["image"]),
    textColor: color,
    accentColor: color,
    cornerRadius: { type: "integer", minimum: 0, maximum: 32 },
    elevation: { type: "integer", minimum: 0, maximum: 8 },
    marginTop: { type: "integer", minimum: 0, maximum: 48 },
    marginBottom: { type: "integer", minimum: 0, maximum: 48 },
});

/** Static item (banner, tile). Components narrow it with `items` in the registry. */
export const ITEM = (
    extra: Record<string, JsonSchema> = {},
    required: string[] = ["image"],
) =>
    obj(
        {
            image: media(["image", "video"]),
            title: text(60),
            subtitle: text(100),
            badge: text(20),
            background: color,
            action: ACTION_REF,
            ...extra,
        },
        required,
    );

// ─── actions ─────────────────────────────────────────────────────────────

export interface ActionDef {
    type: string;
    label: Record<string, string>;
    schema: JsonSchema;
}
const act = (
    type: string,
    label: string,
    properties: Record<string, JsonSchema> = {},
    required: string[] = [],
): ActionDef => ({
    type,
    label: { en: label },
    schema: {
        type: "object",
        additionalProperties: false,
        required: ["type", ...required],
        properties: { type: { const: type }, ...properties },
    },
});

/** Fixed vocabulary of tap actions; the app maps each to a route or an existing customer/* API. */
export const ACTIONS: ActionDef[] = [
    act(
        "navigate",
        "Open a screen",
        {
            screen: screenKey,
            params: {
                type: "object",
                maxProperties: 10,
                additionalProperties: { type: "string", maxLength: 200 },
            },
        },
        ["screen"],
    ),
    act("open_group", "Open a custom group", { key: libraryKey }, ["key"]),
    act("open_category", "Open a category", { categoryId: idString }, [
        "categoryId",
    ]),
    act("open_brand", "Open a brand", { brandId: idString }, ["brandId"]),
    act(
        "open_product",
        "Open a product",
        { slug: { type: "string", pattern: "^[a-z0-9-]{1,191}$" } },
        ["slug"],
    ),
    act("search", "Open search", { query: { type: "string", maxLength: 100 } }),
    act(
        "add_to_cart",
        "Add to cart",
        {
            variantId: idString,
            quantity: { type: "integer", minimum: 1, maximum: 20, default: 1 },
        },
        ["variantId"],
    ),
    act(
        "apply_coupon",
        "Apply a coupon",
        { code: { type: "string", pattern: "^[A-Z0-9_-]{3,30}$" } },
        ["code"],
    ),
    act(
        "open_url",
        "Open a web page",
        {
            url: { type: "string", pattern: "^https://", maxLength: 500 },
            external: { type: "boolean", default: false },
        },
        ["url"],
    ),
    act(
        "deeplink",
        "App deep link",
        {
            url: {
                type: "string",
                pattern: "^[a-z][a-z0-9+.-]*://",
                maxLength: 500,
            },
        },
        ["url"],
    ),
    act(
        "share",
        "Share",
        {
            text: text(200),
            url: { type: "string", pattern: "^https://", maxLength: 500 },
        },
        ["text"],
    ),
    act(
        "call",
        "Call",
        { phone: { type: "string", pattern: "^\\+[1-9][0-9]{6,14}$" } },
        ["phone"],
    ),
    act("copy", "Copy text", { text: { type: "string", maxLength: 200 } }, [
        "text",
    ]),
];

export const ACTION_SCHEMA: JsonSchema = {
    $id: "sdui://action",
    type: "object",
    required: ["type"],
    properties: { type: { enum: ACTIONS.map((a) => a.type) } },
    allOf: ACTIONS.map((a) => ({
        if: { properties: { type: { const: a.type } } },
        then: a.schema,
    })),
};

// ─── data sources ────────────────────────────────────────────────────────

export const PRODUCT_SORTS = [
    "new",
    "bestselling",
    "price_asc",
    "price_desc",
    "discount",
] as const;

/** Product filter shared by the `products` source and RULE custom groups. */
export const PRODUCT_FILTER = {
    categoryIds: { ...idList(), description: "Sub-categories included" },
    brandIds: idList(),
    newWithinDays: {
        type: "integer",
        minimum: 1,
        maximum: 90,
        description: 'Listed in the store in the last N days ("Newly added")',
    },
    flashOnly: { type: "boolean", default: false },
    inStockOnly: { type: "boolean", default: true },
    minDiscountPct: { type: "integer", minimum: 1, maximum: 90 },
    maxPrice: { type: "number", minimum: 1 },
    sort: { enum: PRODUCT_SORTS, default: "bestselling" },
};

export interface SourceDef {
    type: string;
    label: Record<string, string>;
    description: string;
    itemKind: "product" | "category" | "brand" | "group" | "mixed";
    /** Only on TEMPLATE screens (the tapped group / category / brand). */
    templateOnly?: boolean;
    needsLogin?: boolean;
    schema: JsonSchema;
}
const src = (
    type: string,
    props: Record<string, JsonSchema>,
    required: string[] = [],
): JsonSchema => ({
    type: "object",
    additionalProperties: false,
    required: ["type", ...required],
    properties: { type: { const: type }, ...props },
});

export const SOURCES: SourceDef[] = [
    {
        type: "products",
        label: { en: "Products (filter)" },
        itemKind: "product",
        description: "Live products of the user's store matching a filter",
        schema: src("products", { ...PRODUCT_FILTER, limit: limit(12) }),
    },
    {
        type: "group",
        label: { en: "Custom group" },
        itemKind: "mixed",
        description:
            'Items of one custom group ("Fresh items", "Late night sale")',
        schema: src("group", { key: libraryKey, limit: limit(12) }, ["key"]),
    },
    {
        type: "groups",
        label: { en: "Custom groups as tiles" },
        itemKind: "group",
        description:
            "Several custom groups shown as tiles; tap opens the group",
        schema: src(
            "groups",
            {
                keys: {
                    type: "array",
                    items: libraryKey,
                    minItems: 1,
                    maxItems: 20,
                    uniqueItems: true,
                },
            },
            ["keys"],
        ),
    },
    {
        type: "flash_sale",
        label: { en: "Flash sale" },
        itemKind: "product",
        description: "Products on a live flash sale, ending soonest first",
        schema: src("flash_sale", { categoryIds: idList(), limit: limit(12) }),
    },
    {
        type: "reorder",
        label: { en: "Buy again" },
        itemKind: "product",
        needsLogin: true,
        description: "Products the customer ordered in the last 90 days",
        schema: src("reorder", { limit: limit(12) }),
    },
    {
        type: "categories",
        label: { en: "Categories" },
        itemKind: "category",
        description:
            'Categories with products in the store: children of parentId ("0" = top) or exactly ids',
        schema: src("categories", {
            parentId: idString,
            ids: idList(),
            limit: limit(12),
        }),
    },
    {
        type: "brands",
        label: { en: "Brands" },
        itemKind: "brand",
        description:
            "Brands with products in the store (optionally within categories)",
        schema: src("brands", {
            ids: idList(),
            categoryIds: idList(),
            limit: limit(12),
        }),
    },
    {
        type: "entity",
        label: { en: "Opened item" },
        itemKind: "mixed",
        templateOnly: true,
        description:
            "TEMPLATE screens: the items of the tapped group / category / brand (with the landing filters and sort)",
        schema: src("entity", {
            limit: limit(20),
            sort: { enum: PRODUCT_SORTS },
        }),
    },
];
export const SOURCE_MAP = new Map(SOURCES.map((s) => [s.type, s]));

// ─── visibility & targeting ──────────────────────────────────────────────

const appVersionRange = obj({ min: semver, max: semver });

export const VISIBILITY_SCHEMA = obj({
    platforms: {
        type: "array",
        items: { enum: PLATFORMS },
        uniqueItems: true,
        minItems: 1,
    },
    appVersion: appVersionRange,
    from: { type: "string", format: "date-time" },
    to: { type: "string", format: "date-time" },
    daily: obj(
        {
            from: time,
            to: time,
            days: {
                type: "array",
                items: { enum: WEEKDAYS },
                uniqueItems: true,
                minItems: 1,
            },
        },
        ["from", "to"],
    ),
    loggedIn: { type: "boolean" },
    storeIds: idList(500),
    segments: {
        type: "array",
        items: { enum: SEGMENTS },
        uniqueItems: true,
        minItems: 1,
    },
});

export const CONDITIONS_SCHEMA = obj({
    storeIds: idList(500),
    cities: {
        type: "array",
        items: { type: "string", maxLength: 100 },
        maxItems: 100,
        uniqueItems: true,
    },
    platforms: {
        type: "array",
        items: { enum: PLATFORMS },
        uniqueItems: true,
        minItems: 1,
    },
    appVersion: appVersionRange,
    loggedIn: { type: "boolean" },
    segments: {
        type: "array",
        items: { enum: SEGMENTS },
        uniqueItems: true,
        minItems: 1,
    },
    abBucket: obj(
        {
            from: { type: "integer", minimum: 0, maximum: 99 },
            to: { type: "integer", minimum: 0, maximum: 99 },
            salt: { type: "string", maxLength: 40 },
        },
        ["from", "to"],
    ),
});

// ─── custom groups ───────────────────────────────────────────────────────

export const GROUP_ITEMS_SCHEMA: JsonSchema = {
    type: "array",
    maxItems: 200,
    items: obj(
        { type: { enum: ["product", "category", "brand"] }, id: idString },
        ["type", "id"],
    ),
};
export const GROUP_RULE_SCHEMA = obj(PRODUCT_FILTER);
export const GROUP_SCHEDULE_SCHEMA = obj({
    days: {
        type: "array",
        items: { enum: WEEKDAYS },
        uniqueItems: true,
        minItems: 1,
    },
    from: time,
    to: time,
    startsAt: { type: "string", format: "date-time" },
    endsAt: { type: "string", format: "date-time" },
});
export const GROUP_MEDIA_SCHEMA = obj({
    cover: media(["image"]),
    icon: media(["image"]),
    banner: media(["image", "video"]),
});
export const GROUP_LANDING_SCHEMA = obj({
    header: {
        enum: ["banner_large", "banner_compact", "gradient", "plain"],
        description: "Header design of the landing page",
    },
    filters: {
        type: "array",
        items: { enum: ["category", "brand", "price", "discount", "diet"] },
        uniqueItems: true,
    },
    sort: {
        type: "array",
        items: { enum: PRODUCT_SORTS },
        uniqueItems: true,
        minItems: 1,
        description: "Sort options offered; the first is the default",
    },
    layout: obj({
        columns: { type: "integer", minimum: 2, maximum: 3 },
        cardVariant: {
            enum: ["card_compact", "card_standard", "card_large", "list_row"],
        },
    }),
    background: color,
});

// ─── theme (SHELL layout.theme) ──────────────────────────────────────────

export const THEME_SCHEMA = obj(
    {
        colors: {
            type: "object",
            minProperties: 1,
            propertyNames: { pattern: "^[A-Za-z0-9_.-]{1,40}$" },
            additionalProperties: {
                type: "string",
                pattern: "^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$",
            },
        },
        typography: {
            type: "object",
            additionalProperties: obj({
                fontFamily: { type: "string", maxLength: 60 },
                size: { type: "number", minimum: 8, maximum: 48 },
                weight: { enum: [300, 400, 500, 600, 700, 800] },
                lineHeight: { type: "number", minimum: 1, maximum: 2.5 },
            }),
        },
        radius: {
            type: "object",
            additionalProperties: { type: "integer", minimum: 0, maximum: 48 },
        },
        spacing: {
            type: "object",
            additionalProperties: { type: "integer", minimum: 0, maximum: 64 },
        },
    },
    ["colors"],
);

export const DEFAULT_THEME = {
    colors: {
        primary: "#0C831F",
        onPrimary: "#FFFFFF",
        accent: "#F8CB46",
        background: "#FFFFFF",
        surface: "#F5F6FA",
        surfaceWarm: "#FFF4E5",
        surfaceInfo: "#EAF4FF",
        lateNight: "#1B1F3B",
        textPrimary: "#1C1C1C",
        textSecondary: "#666666",
        discount: "#256FEF",
        error: "#D32F2F",
    },
    typography: {
        title: { size: 18, weight: 700 },
        subtitle: { size: 14, weight: 600 },
        body: { size: 13, weight: 400 },
        caption: { size: 11, weight: 500 },
    },
    radius: { card: 12, button: 8, chip: 16 },
    spacing: { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 },
};
