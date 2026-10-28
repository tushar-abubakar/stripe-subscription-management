/** Swagger docs (with sample responses) of the customer app SDUI API: /app/*. */
import { applyDecorators } from "@nestjs/common";
import {
    ApiHeader,
    ApiNotFoundResponse,
    ApiOkResponse,
    ApiOperation,
    ApiParam,
    ApiResponse,
} from "@nestjs/swagger";

/** Headers of every screens endpoint: A/B bucket id for guests and the ETag of the copy the app has. */
export const ApiScreenHeaders = () =>
    applyDecorators(
        ApiHeader({
            name: "X-Device-Id",
            required: false,
            example: "c8f1a2e0-…",
            description: "Stable install id (A/B buckets for guests)",
        }),
        ApiHeader({
            name: "If-None-Match",
            required: false,
            example: '"4be1c0f1…"',
            description: "ETag of the copy the app has → 304 when unchanged",
        }),
    );

const IMG = (n: string) => ({
    type: "image",
    url: `https://cdn.example.com/sdui/${n}.webp`,
    thumbUrl: `https://cdn.example.com/sdui/${n}_t.webp`,
    width: 1440,
    height: 600,
    mimeType: "image/webp",
});
const PRODUCT = {
    kind: "product",
    productId: "1",
    slug: "amul-taaza",
    title: "Amul Taaza Toned Milk",
    brand: "Amul",
    thumbnailUrl: "https://cdn.example.com/p/1_t.webp",
    availability: "AVAILABLE",
    defaultVariantId: "1",
    variants: [
        {
            variantId: "1",
            label: "500 ml",
            unit: "ml",
            unitValue: 500,
            price: { amount: 40, formatted: "৳40.00" },
            mrp: { amount: 56, formatted: "৳56.00" },
            discountPct: 29,
            availability: "AVAILABLE",
            maxOrderQty: 6,
            flashSale: {
                endsAt: "2026-10-24T23:00:00.000Z",
                remaining: 18,
                regularPrice: { amount: 48, formatted: "৳48.00" },
            },
        },
    ],
    action: { type: "open_product", slug: "amul-taaza" },
};

const CACHE_NOTE =
    "**Caching** — send `If-None-Match` with the last `ETag` → `304` (no body) when nothing changed. " +
    "`Cache-Control: private, max-age=<ttlSec>` says how long the copy can be shown without asking (also `ttlSec` in the body): " +
    "it ends when something time-based changes (a late-night section appears, a group schedule ends, a flash sale starts / ends). Keep the last good copy for offline use.";

const SCREEN_EXAMPLE = {
    schemaVersion: 1,
    screen: {
        key: "home",
        kind: "SCREEN",
        title: "হোম",
        version: 8,
        variant: null,
        preview: false,
    },
    appBar: {
        id: "app_bar",
        type: "search_bar",
        variant: "rounded",
        props: { hints: ['"দুধ" খুঁজুন', '"ডিম" খুঁজুন'] },
    },
    sections: [
        {
            id: "hero",
            type: "banner_carousel",
            variant: "peek",
            props: { aspectRatio: 2.4, autoPlayMs: 4000, indicator: "dots" },
            items: [
                {
                    image: IMG("b1"),
                    action: { type: "open_group", key: "fresh" },
                },
            ],
        },
        {
            id: "cats",
            type: "category_grid",
            variant: "icon_tiles",
            header: {
                title: "ক্যাটাগরি অনুযায়ী",
                seeMore: {
                    label: "সব দেখুন",
                    action: { type: "navigate", screen: "categories" },
                },
            },
            layout: { columns: 4, rows: 2, scroll: "grid", gap: 8 },
            data: {
                items: [
                    {
                        kind: "category",
                        categoryId: "3",
                        slug: "dairy",
                        name: "Dairy & Eggs",
                        iconUrl: "https://cdn.example.com/c/3_t.webp",
                        imageUrl: null,
                        action: { type: "open_category", categoryId: "3" },
                    },
                ],
                next: null,
                total: 8,
            },
        },
        {
            id: "stores",
            type: "group_tiles",
            variant: "image_tiles",
            layout: { columns: 3, rows: 1, scroll: "grid" },
            data: {
                items: [
                    {
                        kind: "group",
                        groupKey: "fresh",
                        title: "তাজা পণ্য",
                        subtitle: "আজ সকালে তোলা",
                        image: IMG("g1"),
                        icon: null,
                        endsAt: null,
                        action: { type: "open_group", key: "fresh" },
                    },
                ],
                next: null,
            },
        },
        {
            id: "night",
            type: "flash_sale",
            variant: "dark_night",
            header: {
                title: "লেট নাইট সেল",
                subtitle: "Till 5 AM",
                seeMore: {
                    label: "See all",
                    action: { type: "open_group", key: "late-night" },
                },
            },
            style: { background: "token:lateNight", textColor: "#FFFFFF" },
            layout: { rows: 1, scroll: "horizontal", peek: 0.15 },
            props: { showTimer: true },
            data: {
                items: [PRODUCT],
                next: "app/screens/home/sections/night?v=8&cursor=eyJvIjoxMH0",
                total: 23,
            },
        },
        {
            id: "again",
            type: "product_rail",
            variant: "card_standard",
            header: { title: "আবার কিনুন" },
            layout: { rows: 1, scroll: "horizontal" },
            lazy: true,
            dataUrl: "app/screens/home/sections/again?v=8",
        },
        {
            id: "all",
            type: "product_grid",
            variant: "card_standard",
            layout: { columns: 2, scroll: "vertical" },
            lazy: true,
            dataUrl: "app/screens/home/sections/all?v=8",
        },
    ],
    ttlSec: 20,
};

const LANDING_EXAMPLE = {
    schemaVersion: 1,
    screen: {
        key: "group_landing:late-night",
        kind: "TEMPLATE",
        title: "লেট নাইট সেল",
        version: 3,
        variant: null,
        preview: false,
    },
    entity: { type: "group", key: "late-night" },
    query: { sort: "discount" },
    sections: [
        {
            id: "header",
            type: "entity_header",
            variant: "gradient",
            props: { showItemCount: true, showTimer: true },
            data: {
                kind: "group",
                key: "late-night",
                title: "লেট নাইট সেল",
                subtitle: "Snacks & drinks till 5 AM",
                image: IMG("g5"),
                icon: null,
                background: "token:lateNight",
                itemCount: 23,
                endsAt: "2026-10-24T23:00:00.000Z",
            },
        },
        {
            id: "filters",
            type: "filter_bar",
            variant: "chips",
            data: {
                filters: [
                    {
                        key: "category",
                        param: "categoryId",
                        label: "Category",
                        options: [
                            { id: "12", name: "Snacks", count: 14 },
                            { id: "14", name: "Cold drinks", count: 9 },
                        ],
                    },
                    {
                        key: "price",
                        params: ["minPrice", "maxPrice"],
                        label: "Price",
                        range: { min: 10, max: 450 },
                    },
                ],
                sort: {
                    param: "sort",
                    options: [
                        { key: "discount", label: "Discount" },
                        { key: "price_asc", label: "Price: low to high" },
                    ],
                    selected: "discount",
                },
                selected: { sort: "discount" },
                itemsUrl: "app/landing/group/late-night/items",
            },
        },
        {
            id: "items",
            type: "product_grid",
            variant: "card_compact",
            layout: { columns: 3, scroll: "vertical" },
            data: {
                items: [PRODUCT],
                total: 23,
                next: "app/landing/group/late-night/items?sort=discount&cursor=eyJvIjoyMH0&limit=20",
                itemsUrl: "app/landing/group/late-night/items",
            },
        },
    ],
    settings: { background: "token:lateNight" },
    ttlSec: 20,
};

const NOT_MODIFIED = ApiResponse({
    status: 304,
    description: "Not modified (ETag matched): keep showing your copy",
});

export const ApiShell = () =>
    applyDecorators(
        ApiOperation({
            summary: "App shell: bottom tabs, global app bar, theme",
            description:
                "Load at start (and when the ETag changes). Tabs open screens with `GET app/screens/{key}`.\n\n" +
                CACHE_NOTE,
        }),
        ApiOkResponse({
            schema: {
                example: {
                    schemaVersion: 1,
                    version: 2,
                    theme: {
                        colors: {
                            primary: "#0C831F",
                            onPrimary: "#FFFFFF",
                            lateNight: "#1B1F3B",
                        },
                        typography: { title: { size: 18, weight: 700 } },
                        radius: { card: 12 },
                        spacing: { md: 12 },
                    },
                    appBar: {
                        id: "app_bar",
                        type: "location_header",
                        variant: "default",
                        props: { showEta: true, showProfile: true },
                    },
                    bottomBar: {
                        id: "tabs",
                        type: "bottom_nav",
                        variant: "labeled",
                        props: {
                            tabs: [
                                {
                                    key: "home",
                                    label: "হোম",
                                    icon: "home",
                                    screen: "home",
                                },
                                {
                                    key: "categories",
                                    label: "ক্যাটাগরি",
                                    icon: "grid_view",
                                    screen: "categories",
                                },
                            ],
                        },
                    },
                    ttlSec: 300,
                },
            },
        }),
        NOT_MODIFIED,
    );

export const ApiScreen = () =>
    applyDecorators(
        ApiOperation({
            summary: "A screen, ready to draw",
            description:
                "SCREEN / PAGE keys (home, categories, page:monsoon-sale). Picks the version for this user (targeting / A-B rules → live → newest this app version can draw), " +
                "fills the first sections with store data and marks the rest `lazy` (load from `dataUrl`). Personal sections (buy again) are always lazy. Texts come in the request language; media as URLs. " +
                "Sections are drawn by `type` + `variant`; skip unknown types. `updateRequired: true` = no version this app can draw.\n\n" +
                CACHE_NOTE,
        }),
        ApiParam({ name: "key", example: "home" }),
        ApiOkResponse({ schema: { example: SCREEN_EXAMPLE } }),
        NOT_MODIFIED,
        ApiNotFoundResponse({
            description: "Unknown / inactive screen (SCREEN_NOT_FOUND)",
        }),
    );

export const ApiSection = () =>
    applyDecorators(
        ApiOperation({
            summary: "Data of one section (lazy sections, next pages)",
            description:
                "Follow `dataUrl` / `data.next`. Shared pages: `Cache-Control: private, max-age≤30`; buy-again pages are per user.",
        }),
        ApiParam({ name: "key", example: "home" }),
        ApiParam({ name: "sectionId", example: "all" }),
        ApiOkResponse({
            schema: {
                example: {
                    id: "all",
                    items: [PRODUCT],
                    next: "app/screens/home/sections/all?v=8&cursor=eyJvIjo0MH0",
                    total: 312,
                    ttlSec: 30,
                },
            },
        }),
        ApiNotFoundResponse({
            description:
                "SCREEN_NOT_FOUND / SECTION_NOT_FOUND (hidden now or no data source)",
        }),
    );

export const ApiLanding = () =>
    applyDecorators(
        ApiOperation({
            summary:
                "What opens when a custom group / category / brand is tapped",
            description:
                "`open_group {key}` → `landing/group/{key}`, `open_category {categoryId}` → `landing/category/{id}`, `open_brand {brandId}` → `landing/brand/{id}`. " +
                "Uses the group's own landing screen when the admin set one, else group_landing / category_landing / brand_landing, with the group's landing options " +
                "(header design, filters, sort, columns, card design, background). Send the picked filters / sort as query params; more items from `itemsUrl`.\n\n" +
                CACHE_NOTE,
        }),
        ApiParam({
            name: "type",
            enum: ["group", "category", "brand"],
            example: "group",
        }),
        ApiParam({
            name: "ref",
            description: "Group key, category id or brand id",
            example: "late-night",
        }),
        ApiOkResponse({ schema: { example: LANDING_EXAMPLE } }),
        NOT_MODIFIED,
        ApiNotFoundResponse({
            description:
                "GROUP_NOT_FOUND / GROUP_NOT_AVAILABLE (outside its schedule) / CATEGORY_NOT_FOUND / BRAND_NOT_FOUND",
        }),
    );

export const ApiLandingItems = () =>
    applyDecorators(
        ApiOperation({
            summary: "Products of a landing page (filters, sort, next pages)",
        }),
        ApiParam({
            name: "type",
            enum: ["group", "category", "brand"],
            example: "group",
        }),
        ApiParam({ name: "ref", example: "late-night" }),
        ApiOkResponse({
            schema: {
                example: {
                    id: "late-night",
                    items: [PRODUCT],
                    next: "app/landing/group/late-night/items?sort=discount&cursor=eyJvIjo0MH0",
                    total: 23,
                    ttlSec: 30,
                },
            },
        }),
        ApiNotFoundResponse({ description: "As the landing page" }),
    );

export const ApiPreview = () =>
    applyDecorators(
        ApiOperation({
            summary: "Open an admin preview on a phone",
            description:
                "Token from `POST admin/sdui/screens/{id}/preview` (QR code), valid 30 minutes. Same shape as a screen; never cached.",
        }),
        ApiParam({ name: "token", example: "x1V3pQ…" }),
        ApiOkResponse({
            schema: {
                example: {
                    ...SCREEN_EXAMPLE,
                    screen: {
                        ...SCREEN_EXAMPLE.screen,
                        version: null,
                        preview: true,
                    },
                },
            },
        }),
        ApiNotFoundResponse({
            description: "Expired / unknown token (PREVIEW_NOT_FOUND)",
        }),
    );

export const ApiPreviewSection = () =>
    applyDecorators(
        ApiOperation({ summary: "Section data inside a preview" }),
        ApiParam({ name: "token" }),
        ApiParam({ name: "sectionId" }),
    );
