import { Platform, Segment } from "../schema/contract";

/** Who is asking (built by the app controllers from the request). */
export interface RenderContext {
    /** Store serving the user's location; without it, data sections are empty. */
    storeId: bigint | null;
    userId: bigint | null;
    /** Stable install id: A/B buckets for guests. */
    deviceId: string | null;
    platform: Platform;
    appVersion: string;
    lang: string;
    /** Admin preview: pretend "now" / segment. */
    now?: Date;
    segments?: Segment[];
    /** Filled lazily (rules on cities). */
    city?: string | null;
}

/** Tapped group / category / brand a TEMPLATE screen is rendered for. */
export type EntityType = "group" | "category" | "brand";
export interface EntityRef {
    type: EntityType;
    /** Group key, or category / brand id. */
    ref: string;
}

/** Filters / sort the customer picked on a landing page. */
export interface EntityQuery {
    sort?: string;
    categoryId?: string;
    brandId?: string;
    minPrice?: number;
    maxPrice?: number;
    minDiscountPct?: number;
}

/** One page of a data source. */
export interface SourcePage {
    items: Record<string, unknown>[];
    /** Opaque cursor of the next page (null = end). */
    next: string | null;
    total?: number;
    /** Extra data for the component (flash sale end, reason a page is empty). */
    meta?: Record<string, unknown>;
    /** The page changes by itself then (earliest flash sale start / end): caches must not outlive it. */
    validUntil?: string | null;
}
