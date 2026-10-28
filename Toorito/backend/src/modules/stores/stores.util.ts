import type { LocaleMap } from "@core/locale/locale.service";

/* -------------------------------------------------------------------------- */
/* Limits                                                                     */
/* -------------------------------------------------------------------------- */

export const STORE_LIMITS = {
    serviceRadiusM: { min: 200, max: 50_000 },
    maxAreas: 20,
    maxPolygonPoints: 500,
    /** 0.01 km² — smaller is almost certainly a mis-click. */
    minAreaM2: 10_000,
    /** Every polygon vertex must be within this distance of the store pin. */
    maxAreaDistanceM: 50_000,
    maxCharges: 20,
    maxPrepMinutes: 240,
} as const;

/* -------------------------------------------------------------------------- */
/* Store code: "DS-BNG-KRM01"                                                 */
/* -------------------------------------------------------------------------- */

export const STORE_CODE_PREFIX = "DS";
export const STORE_CODE_PATTERN = /^[A-Z0-9]+(?:-[A-Z0-9]+)*$/;

const CODE_NOISE = new Set([
    "store", "dark", "hub", "pod", "depot", "express", "mart", "mini", "main", "the",
    "and", "of", "near", "sector", "warehouse", "point", "center", "centre", "outlet",
    "branch", "kitchen", "fc", "ds",
]);

/** "ds blr_krm 01" → "DS-BLR-KRM-01". */
export const normalizeStoreCode = (raw: string) =>
    raw
        .trim()
        .toUpperCase()
        .replace(/[\s_]+/g, "-")
        .replace(/[^A-Z0-9-]/g, "")
        .replace(/-{2,}/g, "-")
        .replace(/^-+|-+$/g, "");

export const isValidStoreCode = (code: string) =>
    code.length >= 2 && code.length <= 30 && STORE_CODE_PATTERN.test(code);

/** "Koramangala" → "KRM", "Indiranagar" → "IND", "HSR" → "HSR". */
const abbreviate = (word?: string) => {
    const letters = (word ?? "").toUpperCase().replace(/[^A-Z]/g, "");

    if (!letters) return "";

    const short = letters[0] + letters.slice(1).replace(/[AEIOU]/g, "");

    return (short.length >= 2 ? short : letters).slice(0, 3);
};

/** Suggestion stem from city + store name: ("Bengaluru", "Koramangala Hub") → "DS-BNG-KRM". */
export function storeCodeStem(city?: string, name?: string): string | null {
    const area = (name ?? "")
        .split(/[^A-Za-z0-9]+/)
        .find((word) => word.length > 1 && !/^\d/.test(word) && !CODE_NOISE.has(word.toLowerCase()));

    const parts = [abbreviate(city), abbreviate(area)].filter(Boolean);

    return parts.length ? [STORE_CODE_PREFIX, ...parts].join("-") : null;
}

/* -------------------------------------------------------------------------- */
/* Opening hours: { mon: [["09:00","23:00"]], sat: [["16:00","02:00"]] }      */
/* -------------------------------------------------------------------------- */

export const CLOCK_PATTERN = /^(([01]\d|2[0-3]):[0-5]\d|24:00)$/;

export const DAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;

export type OpeningHours = Partial<Record<(typeof DAY_KEYS)[number], [string, string][]>>;

export const toMinutes = (clock: string) => {
    const [hours, minutes] = clock.split(":").map(Number);
    return hours * 60 + minutes;
};

export function isOpeningHours(value: unknown): value is OpeningHours {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return false;
    }

    return Object.entries(value as Record<string, unknown>).every(
        ([day, ranges]) =>
            (DAY_KEYS as readonly string[]).includes(day) &&
            Array.isArray(ranges) &&
            ranges.length <= 4 &&
            ranges.every(
                (range) =>
                    Array.isArray(range) &&
                    range.length === 2 &&
                    typeof range[0] === "string" &&
                    typeof range[1] === "string" &&
                    CLOCK_PATTERN.test(range[0]) &&
                    CLOCK_PATTERN.test(range[1]) &&
                    range[0] !== range[1],
            ),
    );
}

/* -------------------------------------------------------------------------- */
/* Surcharges (stored as a JSON array in Store.charges)                       */
/* -------------------------------------------------------------------------- */

export const ChargeKind = {
    RAIN_SURGE: "RAIN_SURGE",
    NIGHT_SURGE: "NIGHT_SURGE",
    PEAK_SURGE: "PEAK_SURGE",
    PACKAGING: "PACKAGING",
    CUSTOM: "CUSTOM",
} as const;
export type ChargeKind = (typeof ChargeKind)[keyof typeof ChargeKind];

export const ChargeCalc = { FLAT: "FLAT", PERCENT: "PERCENT" } as const;
export type ChargeCalc = (typeof ChargeCalc)[keyof typeof ChargeCalc];

/** MANUAL: on/off switch (e.g. rain). SCHEDULE: applies inside a time window. */
export const ChargeTrigger = { MANUAL: "MANUAL", SCHEDULE: "SCHEDULE" } as const;
export type ChargeTrigger = (typeof ChargeTrigger)[keyof typeof ChargeTrigger];

export interface ChargeSchedule {
    /** 0 = Sunday … 6 = Saturday; empty = every day. The day the window starts. */
    days: number[];
    from: string;
    to: string;
}

/** One element of Store.charges. */
export interface StoreCharge {
    id: string;
    kind: ChargeKind;
    label: LocaleMap | null;
    calc: ChargeCalc;
    /** FLAT: money. PERCENT: 0–100 of the cart subtotal. */
    amount: number;
    /** PERCENT only: cap in money. */
    maxAmount: number | null;
    trigger: ChargeTrigger;
    schedule: ChargeSchedule | null;
    isActive: boolean;
}

/** Safe read of the JSON column. */
export const chargesOf = (value: unknown): StoreCharge[] =>
    Array.isArray(value) ? (value as StoreCharge[]) : [];

const WEEKDAY: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/** Day of week and minutes since midnight in `timeZone`. */
function localClock(now: Date, timeZone: string) {
    const parts = new Intl.DateTimeFormat("en-US", {
        timeZone,
        weekday: "short",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
    }).formatToParts(now);

    const part = (type: string) => parts.find((p) => p.type === type)?.value ?? "0";

    return {
        day: WEEKDAY[part("weekday")] ?? 0,
        minutes: (Number(part("hour")) % 24) * 60 + Number(part("minute")),
    };
}

/** Whether a charge applies now: MANUAL follows its switch, SCHEDULE its window. */
export function isChargeLive(charge: StoreCharge, timeZone: string, now = new Date()): boolean {
    if (!charge.isActive) return false;
    if (charge.trigger === ChargeTrigger.MANUAL) return true;

    const schedule = charge.schedule;

    if (!schedule?.from || !schedule.to) return false;

    const { day, minutes } = localClock(now, timeZone);
    const from = toMinutes(schedule.from);
    const to = toMinutes(schedule.to);
    const days = schedule.days?.length ? schedule.days : [0, 1, 2, 3, 4, 5, 6];

    if (from < to) {
        return days.includes(day) && minutes >= from && minutes < to;
    }

    // Overnight window, e.g. 22:00 → 06:00
    return (days.includes(day) && minutes >= from) || (days.includes((day + 6) % 7) && minutes < to);
}

/** Money value of a charge for a cart subtotal (for the pricing service). */
export function chargeAmount(charge: StoreCharge, subtotal: number): number {
    if (charge.calc === ChargeCalc.FLAT) {
        return charge.amount;
    }

    const value = (subtotal * charge.amount) / 100;
    const cap = charge.maxAmount ?? Infinity;

    return Math.round(Math.min(value, cap) * 100) / 100;
}

/* -------------------------------------------------------------------------- */
/* Opening hours: "is the store inside its hours right now?"                  */
/* -------------------------------------------------------------------------- */

/**
 * Whether `now` falls inside the store's opening hours (store timezone).
 * `null` / empty hours = no schedule, i.e. always open (manual switch only).
 * A range whose `to` is earlier than `from` runs past midnight.
 */
export function isWithinOpeningHours(hours: unknown, timeZone: string, now = new Date()): boolean {
    if (!isOpeningHours(hours) || !Object.keys(hours).length) return true;

    const { day, minutes } = localClock(now, timeZone);
    const ranges = (d: number) => hours[DAY_KEYS[(d + 7) % 7]] ?? [];

    // Today's ranges (incl. the evening part of overnight ranges).
    for (const [from, to] of ranges(day)) {
        const start = toMinutes(from);
        const end = toMinutes(to);
        if (start < end ? minutes >= start && minutes < end : minutes >= start) return true;
    }

    // Yesterday's overnight ranges spilling into this morning.
    for (const [from, to] of ranges(day - 1)) {
        const start = toMinutes(from);
        const end = toMinutes(to);
        if (start > end && minutes < end) return true;
    }

    return false;
}

/** Live surcharges of a store and their total for a cart subtotal. */
export function liveSurcharges(charges: unknown, timeZone: string, subtotal: number, now = new Date()) {
    const list = chargesOf(charges)
        .filter((charge) => isChargeLive(charge, timeZone, now))
        .map((charge) => ({
            id: charge.id,
            kind: charge.kind,
            label: charge.label,
            amount: chargeAmount(charge, subtotal),
        }));

    return {
        items: list,
        total: Math.round(list.reduce((sum, item) => sum + item.amount, 0) * 100) / 100,
    };
}
