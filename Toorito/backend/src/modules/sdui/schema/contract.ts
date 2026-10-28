/**
 * SDUI layout contract — shared by the admin designer, this backend and the
 * Flutter renderer. Stored in SduiScreen.draftLayout / SduiScreenVersion.layout
 * and SduiSection.node.
 *
 * Every user-facing text is a language map: {"en": "Fresh items", "bn": "তাজা পণ্য"}.
 * Bump SDUI_SCHEMA_VERSION only for breaking changes; new components /
 * variants are additive and gated by minAppVersion.
 */
import { SduiScreenKind } from "@prisma-client/enums";

export const SDUI_SCHEMA_VERSION = 1;

export const SDUI_LIMITS = {
    /** Top-level sections on one screen. */
    maxSections: 60,
    /** All nodes (sections + container children + appBar / bottomBar). */
    maxNodes: 300,
    /** section → container → child. */
    maxDepth: 3,
    maxBytes: 256 * 1024,
    /** Items a data source may return per page. */
    maxItems: 50,
} as const;

export const PLATFORMS = ["android", "ios", "web"] as const;
export type Platform = (typeof PLATFORMS)[number];

export const SEGMENTS = ["GUEST", "NEW_CUSTOMER", "REPEAT_CUSTOMER"] as const;
export type Segment = (typeof SEGMENTS)[number];

export const WEEKDAYS = [
    "MON",
    "TUE",
    "WED",
    "THU",
    "FRI",
    "SAT",
    "SUN",
] as const;

export type I18nText = Record<string, string>;
export type Slot = "appBar" | "body" | "bottomBar";

export interface SduiAction {
    type: string;
    [key: string]: unknown;
}

/** One section (or a child inside a container). */
export interface SduiNode {
    /** Unique in the layout: ^[A-Za-z0-9_-]{1,40}$ (analytics, lazy loading, diff). */
    id: string;
    /** Component type (see component.registry.ts). */
    type: string;
    /** Design choice of this type ("card_compact", "peek", …). Default = first variant. */
    variant?: string;
    /** Title row: { title, subtitle, icon, seeMore: { label, action } } */
    header?: Record<string, unknown>;
    /** Grid: { columns 1–5, rows, scroll: horizontal | vertical | grid, itemAspect, gap, padding } */
    layout?: Record<string, unknown>;
    /** Look: { background, backgroundImage, textColor, cornerRadius, elevation } */
    style?: Record<string, unknown>;
    /** Component-specific options (autoPlayMs, showTimer, …). */
    props?: Record<string, unknown>;
    /** Live data: { type: products | group | groups | flash_sale | reorder | categories | brands | entity, … } */
    source?: Record<string, unknown> & { type: string };
    /** Static items (banners, tiles): [{ image, title, subtitle, action, … }] */
    items?: Record<string, unknown>[];
    /** Container only. */
    children?: SduiNode[];
    /** Tap target of the whole section. */
    action?: SduiAction;
    visibility?: SduiVisibility;
    /** Filled by a follow-up request (below the fold). */
    lazy?: boolean;
    /** section_ref only: key of a reusable SduiSection. */
    ref?: string;
}

export interface SduiVisibility {
    platforms?: Platform[];
    appVersion?: { min?: string; max?: string };
    from?: string;
    to?: string;
    /** Every day (or on `days`) between from–to local store time, e.g. a late-night sale 23:00–05:00. */
    daily?: { from: string; to: string; days?: (typeof WEEKDAYS)[number][] };
    loggedIn?: boolean;
    storeIds?: string[];
    segments?: Segment[];
}

export interface SduiLayout {
    schemaVersion: number;
    appBar?: SduiNode;
    sections: SduiNode[];
    /** SHELL only. */
    bottomBar?: SduiNode;
    /** SHELL only: design tokens { colors, typography, radius, spacing }. */
    theme?: Record<string, unknown>;
    settings?: { background?: string; pullToRefresh?: boolean };
}

/** A problem in a layout; `path` is a JSON pointer (/sections/2/header/title). */
export interface LayoutIssue {
    path: string;
    nodeId?: string;
    code: string;
    message: string;
}

export interface LayoutDeps {
    components: string[];
    sectionKeys: string[];
    groupKeys: string[];
    mediaIds: string[];
    screenKeys: string[];
    minAppVersion: string | null;
}

/** Targeting / A-B rule stored in SduiScreen.rules (JSON array). */
export interface SduiRule {
    id: string;
    name: string;
    versionId: string;
    priority: number;
    isActive: boolean;
    startsAt: string | null;
    endsAt: string | null;
    conditions: Record<string, unknown>;
    createdById: string | null;
    updatedAt: string;
}

export const SCREEN_KEY_PATTERN = /^[a-z0-9][a-z0-9_:-]{1,79}$/;
export const LIBRARY_KEY_PATTERN = /^[a-z0-9][a-z0-9_-]{1,79}$/;
export const NODE_ID_PATTERN = /^[A-Za-z0-9_-]{1,40}$/;

/** Created on first boot; editable, never deletable. */
export const SYSTEM_SCREENS: {
    key: string;
    kind: SduiScreenKind;
    title: I18nText;
    description: I18nText;
}[] = [
    {
        key: "shell",
        kind: "SHELL",
        title: { en: "App shell" },
        description: { en: "Bottom tabs, global app bar and theme" },
    },
    {
        key: "home",
        kind: "SCREEN",
        title: { en: "Home" },
        description: { en: "First tab" },
    },
    {
        key: "categories",
        kind: "SCREEN",
        title: { en: "Categories" },
        description: { en: "All categories tab" },
    },
    {
        key: "group_landing",
        kind: "TEMPLATE",
        title: { en: "Custom group page" },
        description: {
            en: "Opens when a custom group is tapped (default design)",
        },
    },
    {
        key: "category_landing",
        kind: "TEMPLATE",
        title: { en: "Category page" },
        description: { en: "Opens when a category is tapped" },
    },
    {
        key: "brand_landing",
        kind: "TEMPLATE",
        title: { en: "Brand page" },
        description: { en: "Opens when a brand is tapped" },
    },
    {
        key: "pdp",
        kind: "TEMPLATE",
        title: { en: "Product page extras" },
        description: { en: "Sections around the product detail" },
    },
    {
        key: "cart_empty",
        kind: "SCREEN",
        title: { en: "Empty cart" },
        description: { en: "Shown when the cart is empty" },
    },
];
