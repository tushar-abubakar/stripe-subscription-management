import { createHash, randomBytes } from "crypto";
import { parsePhoneNumberFromString } from "libphonenumber-js";

export const sha256 = (s: string) =>
    createHash("sha256").update(s).digest("hex");

export const randomToken = (bytes = 32) => randomBytes(bytes).toString("hex");

export const money = (n: number) =>
    Math.round((n + Number.EPSILON) * 100) / 100;

export const num = (d: any) => (d == null ? 0 : Number(d));

export const orderNumber = () => {
    const d = new Date();
    const ymd = `${String(d.getFullYear()).slice(2)}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
    return `QC-${ymd}-${randomBytes(3).toString("hex").toUpperCase()}`;
};
export const docNumber = (prefix: string) =>
    `${prefix}-${Date.now().toString(36).toUpperCase()}${randomBytes(2).toString("hex").toUpperCase()}`;

/** Date-only (UTC midnight) for the calendar day in `tz` — for Postgres DATE columns. */
export function todayInTz(tz = "Asia/Dhaka", d = new Date()): Date {
    return new Date(
        `${new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(d)}T00:00:00.000Z`,
    );
}
export const addDays = (d: Date, n: number) =>
    new Date(d.getTime() + n * 86400000);

export function pageParams(
    q: { page?: number | string; limit?: number | string },
    max = 100,
) {
    const limit = Math.min(Math.max(+(q.limit || 20), 1), max);
    const page = Math.max(+(q.page || 1), 1);
    return { take: limit, skip: (page - 1) * limit, page, limit };
}

/** Language-independent search normalisation (NFKC + lowercase). */
export const normalizeSearch = (s: string) =>
    s.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();

/** Normalize a phone number to E.164 format if valid, otherwise return null. */
export const normalizeE164Phone = (value: string): string | null => {
    const parsed = parsePhoneNumberFromString(value);
    if (!parsed || !parsed.isValid()) {
        return null;
    }
    return parsed.number;
};

/** Converts an optional number into a `BigInt`. `null` / `undefined` become `undefined` */
export const toBigInt = (value?: string | number | bigint | null) =>
    value == null ? undefined : BigInt(value);

/** Make a string safe for use in a URL slug. */
export const toUrlSlug = (str: string) =>
    str
        .normalize("NFKD")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 120);

/** "YYYY-MM-DD" calendar day of `d` in `tz`. */
export const localDateString = (tz: string, d = new Date()) =>
    new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(d);

/** Offset (ms) of `tz` from UTC at the instant `at` (e.g. +6h for Asia/Dhaka). */
export function tzOffsetMs(tz: string, at: Date): number {
    const parts = new Intl.DateTimeFormat("en-US", {
        timeZone: tz,
        hourCycle: "h23",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
    }).formatToParts(at);
    const get = (type: string) =>
        Number(parts.find((p) => p.type === type)?.value ?? 0);
    const wall = Date.UTC(
        get("year"),
        get("month") - 1,
        get("day"),
        get("hour") % 24,
        get("minute"),
        get("second"),
    );
    return wall - Math.floor(at.getTime() / 1000) * 1000;
}

/** UTC instant of local midnight of `date` ("YYYY-MM-DD") in `tz` (DST-safe). */
export function zonedStartOfDay(date: string, tz: string): Date {
    const [y, m, d] = date.slice(0, 10).split("-").map(Number);
    const wall = Date.UTC(y, m - 1, d);
    const first = tzOffsetMs(tz, new Date(wall));
    let utc = wall - first;
    const second = tzOffsetMs(tz, new Date(utc));
    if (second !== first) utc = wall - second;
    return new Date(utc);
}
