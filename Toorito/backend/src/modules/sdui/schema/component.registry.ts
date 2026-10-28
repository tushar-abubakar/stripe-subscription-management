/**
 * Component registry — the single list of what the designer can place and the
 * app can draw. GET admin/sdui/components serves it; the admin panel builds
 * its palette, variant pickers and forms from it. Flutter keeps one widget per
 * `type` + `variant`.
 *
 * Adding a component or variant = one entry here (with minAppVersion = first
 * app release that can draw it) + the Flutter widget. Older apps never get it.
 */
import { SduiScreenKind } from "@prisma-client/enums";
import { Slot } from "./contract";
import { ITEM, JsonSchema, media, obj, text } from "./definitions";

export interface VariantDef {
    key: string;
    label: Record<string, string>;
    description?: Record<string, string>;
    minAppVersion?: string;
}

export interface ComponentDef {
    type: string;
    label: Record<string, string>;
    description: Record<string, string>;
    category:
        | "layout"
        | "media"
        | "text"
        | "commerce"
        | "navigation"
        | "template"
        | "library";
    /** Material icon for the palette. */
    icon: string;
    slots: Slot[];
    /** Screen kinds allowed (default: SCREEN, PAGE, TEMPLATE). */
    kinds?: SduiScreenKind[];
    /** Design choices; the first is the default. */
    variants: VariantDef[];
    /** Accepts a header (title / subtitle / See all). */
    header?: boolean;
    /** Grid limits; undefined = no layout block. */
    layout?: {
        columns?: [number, number];
        rows?: [number, number];
        scroll?: string[];
    };
    /** Accepts a style block. */
    style?: boolean;
    /** Component-specific options. */
    propsSchema?: JsonSchema;
    /** Data sources it can use. */
    sources?: string[];
    sourceRequired?: boolean;
    /** Static items (banners, tiles). */
    items?: { schema: JsonSchema; min: number; max: number };
    /** Container only: allowed child types (true = any body component). */
    children?: true | string[];
    maxChildren?: number;
    actionable?: boolean;
    lazyable?: boolean;
    minAppVersion: string;
    /** Dropped on the canvas (id is added by the designer). */
    defaults: Record<string, unknown>;
}

const v = (key: string, label: string, minAppVersion?: string): VariantDef => ({
    key,
    label: { en: label },
    ...(minAppVersion && { minAppVersion }),
});
const BODY: Slot[] = ["body"];
const PRODUCT_SOURCES = [
    "products",
    "group",
    "flash_sale",
    "reorder",
    "entity",
];
const PRODUCT_CARD_VARIANTS = [
    v("card_standard", "Standard card"),
    v("card_compact", "Compact card"),
    v("card_large", "Large card"),
    v("list_row", "List row"),
];
const productCardProps = obj({
    showAddButton: { type: "boolean", default: true },
    showDiscountBadge: { type: "boolean", default: true },
    showUnit: { type: "boolean", default: true },
    showDeliveryTime: { type: "boolean", default: false },
});

export const COMPONENTS: ComponentDef[] = [
    // ── layout ────────────────────────────────────────────────────────────
    {
        type: "container",
        label: { en: "Container" },
        description: {
            en: 'Holds other sections in columns / rows, with one header and background (e.g. a themed "Monsoon store" block).',
        },
        category: "layout",
        icon: "dashboard",
        slots: BODY,
        variants: [
            v("plain", "Plain"),
            v("card", "Card"),
            v("tinted", "Tinted background"),
        ],
        header: true,
        layout: {
            columns: [1, 5],
            rows: [1, 10],
            scroll: ["none", "horizontal", "grid"],
        },
        style: true,
        children: true,
        maxChildren: 20,
        minAppVersion: "1.0.0",
        defaults: {
            type: "container",
            variant: "card",
            layout: { columns: 1, scroll: "none" },
            children: [],
        },
    },
    {
        type: "spacer",
        label: { en: "Spacer" },
        description: { en: "Empty vertical space." },
        category: "layout",
        icon: "height",
        slots: BODY,
        variants: [v("default", "Default")],
        propsSchema: obj(
            {
                height: {
                    type: "integer",
                    minimum: 4,
                    maximum: 96,
                    default: 16,
                },
            },
            ["height"],
        ),
        minAppVersion: "1.0.0",
        defaults: { type: "spacer", props: { height: 16 } },
    },
    {
        type: "divider",
        label: { en: "Divider" },
        description: { en: "Line between sections." },
        category: "layout",
        icon: "horizontal_rule",
        slots: BODY,
        variants: [v("line", "Line"), v("thick", "Thick band")],
        style: true,
        minAppVersion: "1.0.0",
        defaults: { type: "divider", variant: "line" },
    },
    // ── text ──────────────────────────────────────────────────────────────
    {
        type: "heading",
        label: { en: "Heading" },
        description: { en: "Standalone title text." },
        category: "text",
        icon: "title",
        slots: ["body", "appBar"],
        variants: [
            v("title", "Title"),
            v("subtitle", "Subtitle"),
            v("caption", "Caption"),
        ],
        style: true,
        propsSchema: obj(
            {
                text: text(120),
                align: { enum: ["start", "center", "end"], default: "start" },
            },
            ["text"],
        ),
        actionable: true,
        minAppVersion: "1.0.0",
        defaults: {
            type: "heading",
            variant: "title",
            props: { text: { en: "Heading" } },
        },
    },
    {
        type: "notice_strip",
        label: { en: "Notice strip" },
        description: {
            en: "One-line message: free delivery, rain surcharge, store closing soon.",
        },
        category: "text",
        icon: "campaign",
        slots: ["body", "appBar"],
        variants: [
            v("info", "Info"),
            v("promo", "Promo"),
            v("warning", "Warning"),
        ],
        style: true,
        propsSchema: obj(
            {
                text: text(140),
                icon: { type: "string", pattern: "^[a-z0-9_]{1,40}$" },
                dismissible: { type: "boolean", default: false },
            },
            ["text"],
        ),
        actionable: true,
        minAppVersion: "1.0.0",
        defaults: {
            type: "notice_strip",
            variant: "info",
            props: {
                text: { en: "Free delivery above ৳199" },
                icon: "local_shipping",
            },
        },
    },
    // ── media ─────────────────────────────────────────────────────────────
    {
        type: "banner",
        label: { en: "Banner" },
        description: { en: "One image / video with a tap action." },
        category: "media",
        icon: "image",
        slots: BODY,
        variants: [
            v("full_width", "Full width"),
            v("rounded", "Rounded inset"),
            v("framed", "Framed card"),
        ],
        style: true,
        layout: { scroll: ["none"] },
        propsSchema: obj({
            aspectRatio: {
                type: "number",
                minimum: 0.2,
                maximum: 5,
                default: 2.4,
            },
        }),
        items: { schema: ITEM(), min: 1, max: 1 },
        minAppVersion: "1.0.0",
        defaults: {
            type: "banner",
            variant: "rounded",
            props: { aspectRatio: 2.4 },
            items: [],
        },
    },
    {
        type: "banner_carousel",
        label: { en: "Banner carousel" },
        description: { en: "Swipeable banners, each with its own action." },
        category: "media",
        icon: "view_carousel",
        slots: BODY,
        variants: [
            v("full_bleed", "Full bleed"),
            v("peek", "Peek next"),
            v("cards", "Cards"),
            v("stacked", "Stacked deck", "1.1.0"),
        ],
        header: true,
        style: true,
        propsSchema: obj({
            aspectRatio: {
                type: "number",
                minimum: 0.2,
                maximum: 5,
                default: 2.4,
            },
            autoPlayMs: {
                type: "integer",
                minimum: 0,
                maximum: 15000,
                default: 4000,
                description: "0 = no autoplay",
            },
            indicator: {
                enum: ["dots", "bar", "number", "none"],
                default: "dots",
            },
            loop: { type: "boolean", default: true },
        }),
        items: { schema: ITEM(), min: 1, max: 10 },
        minAppVersion: "1.0.0",
        defaults: {
            type: "banner_carousel",
            variant: "peek",
            props: { aspectRatio: 2.4, autoPlayMs: 4000, indicator: "dots" },
            items: [],
        },
    },
    {
        type: "banner_grid",
        label: { en: "Banner tiles" },
        description: {
            en: 'Image tiles in columns × rows (offer tiles, "Shop by store").',
        },
        category: "media",
        icon: "view_module",
        slots: BODY,
        variants: [
            v("tiles", "Equal tiles"),
            v("mosaic", "Mosaic (first tile large)"),
            v("cards_with_text", "Cards with text"),
        ],
        header: true,
        layout: {
            columns: [2, 5],
            rows: [1, 6],
            scroll: ["grid", "horizontal"],
        },
        style: true,
        items: { schema: ITEM(), min: 2, max: 20 },
        minAppVersion: "1.0.0",
        defaults: {
            type: "banner_grid",
            variant: "tiles",
            layout: { columns: 2, rows: 2, scroll: "grid" },
            items: [],
        },
    },
    {
        type: "video_banner",
        label: { en: "Video banner" },
        description: { en: "Muted autoplay video with poster." },
        category: "media",
        icon: "smart_display",
        slots: BODY,
        variants: [v("inline", "Inline"), v("full_width", "Full width")],
        style: true,
        propsSchema: obj({
            aspectRatio: {
                type: "number",
                minimum: 0.2,
                maximum: 5,
                default: 1.78,
            },
            autoplay: { type: "boolean", default: true },
            loop: { type: "boolean", default: true },
        }),
        items: {
            schema: ITEM({ poster: media(["image"]) }, ["image", "poster"]),
            min: 1,
            max: 1,
        },
        minAppVersion: "1.1.0",
        defaults: { type: "video_banner", variant: "inline", items: [] },
    },
    // ── commerce ──────────────────────────────────────────────────────────
    {
        type: "category_grid",
        label: { en: "Categories" },
        description: {
            en: "Category tiles in columns × rows (only categories with products in the user's store).",
        },
        category: "commerce",
        icon: "apps",
        slots: BODY,
        variants: [
            v("icon_tiles", "Icon tiles"),
            v("image_cards", "Image cards"),
            v("circles", "Circles"),
            v("chips", "Chips"),
        ],
        header: true,
        layout: {
            columns: [3, 5],
            rows: [1, 6],
            scroll: ["grid", "horizontal"],
        },
        style: true,
        propsSchema: obj({ showNames: { type: "boolean", default: true } }),
        sources: ["categories", "group"],
        sourceRequired: true,
        lazyable: true,
        minAppVersion: "1.0.0",
        defaults: {
            type: "category_grid",
            variant: "icon_tiles",
            header: { title: { en: "Shop by category" } },
            layout: { columns: 4, rows: 2, scroll: "grid" },
            source: { type: "categories", parentId: "0", limit: 8 },
        },
    },
    {
        type: "product_rail",
        label: { en: "Product rail" },
        description: {
            en: "Products with live price, stock and ADD (bestsellers, newly added, custom group, buy again).",
        },
        category: "commerce",
        icon: "view_week",
        slots: BODY,
        variants: PRODUCT_CARD_VARIANTS,
        header: true,
        layout: {
            columns: [2, 4],
            rows: [1, 3],
            scroll: ["horizontal", "grid"],
        },
        style: true,
        propsSchema: productCardProps,
        sources: PRODUCT_SOURCES,
        sourceRequired: true,
        lazyable: true,
        minAppVersion: "1.0.0",
        defaults: {
            type: "product_rail",
            variant: "card_standard",
            header: {
                title: { en: "Bestsellers" },
                seeMore: {
                    label: { en: "See all" },
                    action: { type: "open_group", key: "bestsellers" },
                },
            },
            layout: { rows: 1, scroll: "horizontal", peek: 0.2 },
            source: { type: "products", sort: "bestselling", limit: 12 },
        },
    },
    {
        type: "product_grid",
        label: { en: "Product grid" },
        description: {
            en: "Product cards in 2–3 columns, loads more while scrolling.",
        },
        category: "commerce",
        icon: "grid_view",
        slots: BODY,
        variants: PRODUCT_CARD_VARIANTS,
        header: true,
        layout: { columns: [2, 3], scroll: ["vertical"] },
        style: true,
        propsSchema: productCardProps,
        sources: PRODUCT_SOURCES,
        sourceRequired: true,
        lazyable: true,
        minAppVersion: "1.0.0",
        defaults: {
            type: "product_grid",
            variant: "card_standard",
            layout: { columns: 2, scroll: "vertical" },
            source: { type: "products", sort: "new", limit: 20 },
            lazy: true,
        },
    },
    {
        type: "flash_sale",
        label: { en: "Flash / timed sale" },
        description: {
            en: "Products on sale with a countdown. Hidden when nothing is on sale. Use a group with a schedule for a late-night sale.",
        },
        category: "commerce",
        icon: "bolt",
        slots: BODY,
        variants: [
            v("timer_header", "Timer in header"),
            v("banner_header", "Banner header"),
            v("dark_night", "Night theme"),
        ],
        header: true,
        layout: {
            columns: [2, 4],
            rows: [1, 2],
            scroll: ["horizontal", "grid"],
        },
        style: true,
        propsSchema: obj({
            showTimer: { type: "boolean", default: true },
            endsLabel: text(30),
            ...(productCardProps.properties as Record<string, JsonSchema>),
        }),
        sources: ["flash_sale", "group"],
        sourceRequired: true,
        minAppVersion: "1.0.0",
        defaults: {
            type: "flash_sale",
            variant: "timer_header",
            header: { title: { en: "Flash sale" } },
            props: { showTimer: true },
            layout: { rows: 1, scroll: "horizontal" },
            source: { type: "flash_sale", limit: 10 },
        },
    },
    {
        type: "group_tiles",
        label: { en: "Custom group tiles" },
        description: {
            en: 'Tiles of custom groups ("Fresh items", "Late night", "Under ৳99"). Tapping one opens its landing page.',
        },
        category: "commerce",
        icon: "auto_awesome_mosaic",
        slots: BODY,
        variants: [
            v("image_tiles", "Image tiles"),
            v("icon_cards", "Icon cards"),
            v("pills", "Pills"),
        ],
        header: true,
        layout: {
            columns: [2, 5],
            rows: [1, 4],
            scroll: ["grid", "horizontal"],
        },
        style: true,
        sources: ["groups"],
        sourceRequired: true,
        minAppVersion: "1.0.0",
        defaults: {
            type: "group_tiles",
            variant: "image_tiles",
            layout: { columns: 3, rows: 1, scroll: "grid" },
            source: { type: "groups", keys: [] },
        },
    },
    {
        type: "brand_rail",
        label: { en: "Brands" },
        description: { en: "Brand logos (brands with products in the store)." },
        category: "commerce",
        icon: "verified",
        slots: BODY,
        variants: [
            v("logo_circle", "Circle logos"),
            v("logo_card", "Logo cards"),
        ],
        header: true,
        layout: {
            columns: [3, 5],
            rows: [1, 3],
            scroll: ["horizontal", "grid"],
        },
        style: true,
        sources: ["brands", "group"],
        sourceRequired: true,
        lazyable: true,
        minAppVersion: "1.0.0",
        defaults: {
            type: "brand_rail",
            variant: "logo_circle",
            header: { title: { en: "Top brands" } },
            layout: { rows: 1, scroll: "horizontal" },
            source: { type: "brands", limit: 12 },
        },
    },
    // ── navigation ────────────────────────────────────────────────────────
    {
        type: "search_bar",
        label: { en: "Search bar" },
        description: { en: "Opens search; rotating hints." },
        category: "navigation",
        icon: "search",
        slots: ["appBar", "body"],
        variants: [v("rounded", "Rounded"), v("flat", "Flat")],
        style: true,
        propsSchema: obj({
            hints: { type: "array", minItems: 1, maxItems: 8, items: text(60) },
            rotateMs: {
                type: "integer",
                minimum: 1500,
                maximum: 10000,
                default: 3000,
            },
        }),
        actionable: true,
        minAppVersion: "1.0.0",
        defaults: {
            type: "search_bar",
            variant: "rounded",
            props: { hints: [{ en: 'Search "milk"', bn: '"দুধ" খুঁজুন' }] },
        },
    },
    {
        type: "location_header",
        label: { en: "Location header" },
        description: {
            en: "Delivery address, ETA and store status (filled by the app).",
        },
        category: "navigation",
        icon: "location_on",
        slots: ["appBar"],
        variants: [v("default", "Default"), v("compact", "Compact")],
        style: true,
        propsSchema: obj({
            showEta: { type: "boolean", default: true },
            showProfile: { type: "boolean", default: true },
        }),
        minAppVersion: "1.0.0",
        defaults: {
            type: "location_header",
            variant: "default",
            props: { showEta: true, showProfile: true },
        },
    },
    {
        type: "bottom_nav",
        label: { en: "Bottom tabs" },
        description: { en: "App tabs (shell only)." },
        category: "navigation",
        icon: "bottom_navigation",
        slots: ["bottomBar"],
        kinds: ["SHELL"],
        variants: [v("labeled", "Icons + labels"), v("icons", "Icons only")],
        style: true,
        propsSchema: obj(
            {
                tabs: {
                    type: "array",
                    minItems: 2,
                    maxItems: 5,
                    items: obj(
                        {
                            key: {
                                type: "string",
                                pattern: "^[a-z0-9_]{1,30}$",
                            },
                            label: text(20),
                            icon: {
                                type: "string",
                                pattern: "^[a-z0-9_]{1,40}$",
                            },
                            activeIcon: {
                                type: "string",
                                pattern: "^[a-z0-9_]{1,40}$",
                            },
                            screen: {
                                type: "string",
                                pattern: "^[a-z0-9][a-z0-9_:-]{1,79}$",
                            },
                            badge: {
                                enum: ["none", "cart_count"],
                                default: "none",
                            },
                        },
                        ["key", "label", "icon", "screen"],
                    ),
                },
            },
            ["tabs"],
        ),
        minAppVersion: "1.0.0",
        defaults: {
            type: "bottom_nav",
            variant: "labeled",
            props: {
                tabs: [
                    {
                        key: "home",
                        label: { en: "Home", bn: "হোম" },
                        icon: "home",
                        screen: "home",
                    },
                    {
                        key: "categories",
                        label: { en: "Categories", bn: "ক্যাটাগরি" },
                        icon: "grid_view",
                        screen: "categories",
                    },
                ],
            },
        },
    },
    // ── landing templates (what opens when a group / category / brand is tapped) ──
    {
        type: "entity_header",
        label: { en: "Opened item header" },
        description: {
            en: "Header of a landing page: title, subtitle and banner of the tapped group / category / brand.",
        },
        category: "template",
        icon: "web_asset",
        slots: BODY,
        kinds: ["TEMPLATE"],
        variants: [
            v("banner_large", "Large banner"),
            v("banner_compact", "Compact banner"),
            v("gradient", "Gradient"),
            v("plain", "Plain title"),
        ],
        style: true,
        propsSchema: obj({
            showItemCount: { type: "boolean", default: true },
            showTimer: {
                type: "boolean",
                default: true,
                description: "Scheduled groups: time left",
            },
        }),
        minAppVersion: "1.0.0",
        defaults: { type: "entity_header", variant: "banner_large" },
    },
    {
        type: "subcategory_tabs",
        label: { en: "Sub-category tabs" },
        description: {
            en: "Category / group page: chips or a side rail to switch sub-categories.",
        },
        category: "template",
        icon: "tab",
        slots: BODY,
        kinds: ["TEMPLATE"],
        variants: [
            v("chips", "Chips"),
            v("side_rail", "Side rail (Blinkit style)"),
        ],
        style: true,
        minAppVersion: "1.0.0",
        defaults: { type: "subcategory_tabs", variant: "side_rail" },
    },
    {
        type: "filter_bar",
        label: { en: "Filters & sort" },
        description: {
            en: "Filters and sort for the opened item (options come from the group's landing settings).",
        },
        category: "template",
        icon: "tune",
        slots: BODY,
        kinds: ["TEMPLATE"],
        variants: [v("chips", "Chips row"), v("button", "Filter button")],
        style: true,
        minAppVersion: "1.0.0",
        defaults: { type: "filter_bar", variant: "chips" },
    },
    // ── library ───────────────────────────────────────────────────────────
    {
        type: "section_ref",
        label: { en: "Saved section" },
        description: {
            en: "Places a reusable section from the library; editing it updates every screen.",
        },
        category: "library",
        icon: "bookmark",
        slots: BODY,
        variants: [v("default", "Default")],
        minAppVersion: "1.0.0",
        defaults: { type: "section_ref", ref: "" },
    },
];

export const COMPONENT_MAP = new Map(COMPONENTS.map((c) => [c.type, c]));
