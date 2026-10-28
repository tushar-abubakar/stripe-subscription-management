/**
 * Time windows in the store's time zone: section visibility (from / to, daily 23:00–05:00) and custom group
 * schedules. Each check also reports when its answer changes next, so cached responses expire exactly then.
 */
import { WEEKDAYS } from "../schema/contract";

type Day = (typeof WEEKDAYS)[number];
export interface Daily {
    from: string;
    to: string;
    days?: Day[];
}

const fmt = new Map<string, Intl.DateTimeFormat>();
function local(now: Date, tz: string) {
    let f = fmt.get(tz);
    if (!f)
        fmt.set(
            tz,
            (f = new Intl.DateTimeFormat("en-GB", {
                timeZone: tz,
                weekday: "short",
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
                hourCycle: "h23",
            })),
        );
    const p = Object.fromEntries(
        f.formatToParts(now).map((x) => [x.type, x.value]),
    );
    const day = String(p.weekday).toUpperCase().slice(0, 3) as Day;
    return {
        day,
        sec: Number(p.hour) * 3600 + Number(p.minute) * 60 + Number(p.second),
    };
}
const toSec = (hhmm: string) =>
    Number(hhmm.slice(0, 2)) * 3600 + Number(hhmm.slice(3, 5)) * 60;
const prevDay = (d: Day) => WEEKDAYS[(WEEKDAYS.indexOf(d) + 6) % 7];

/** Earliest of the boundaries tracked while rendering (seconds from now). */
export class Boundary {
    sec = Infinity;
    at(date: Date | string | null | undefined, now: Date) {
        if (!date) return;
        const s = (new Date(date).getTime() - now.getTime()) / 1000;
        if (s > 0) this.sec = Math.min(this.sec, s);
    }
    in(sec: number) {
        if (sec > 0) this.sec = Math.min(this.sec, sec);
    }
}

/** Inside a daily window (crossing midnight allowed; `days` = the day the window starts). */
export function inDaily(w: Daily, now: Date, tz: string, b?: Boundary) {
    const { day, sec } = local(now, tz);
    const f = toSec(w.from);
    const t = toSec(w.to);
    const dayOk = (d: Day) => !w.days?.length || w.days.includes(d);
    let on: boolean;
    if (f === t) on = dayOk(day);
    else if (f < t) on = dayOk(day) && sec >= f && sec < t;
    else on = (sec >= f && dayOk(day)) || (sec < t && dayOk(prevDay(day)));
    if (b)
        for (const edge of [f, t]) b.in((edge - sec + 86400) % 86400 || 86400);
    return on;
}

/** Inside [from, to) (ISO strings, either optional). */
export function inRange(
    from: string | null | undefined,
    to: string | null | undefined,
    now: Date,
    b?: Boundary,
) {
    b?.at(from, now);
    b?.at(to, now);
    const n = now.toISOString();
    return (
        !(from && new Date(from).toISOString() > n) &&
        !(to && new Date(to).toISOString() <= n)
    );
}

export interface GroupSchedule {
    days?: Day[];
    from?: string;
    to?: string;
    startsAt?: string;
    endsAt?: string;
}

/** A custom group is on: inside startsAt–endsAt and, with from / to, inside today's window. */
export function scheduleOn(
    s: GroupSchedule | null | undefined,
    now: Date,
    tz: string,
    b?: Boundary,
) {
    if (!s) return true;
    if (!inRange(s.startsAt, s.endsAt, now, b)) return false;
    if (s.from && s.to)
        return inDaily({ from: s.from, to: s.to, days: s.days }, now, tz, b);
    if (s.days?.length) {
        const { day, sec } = local(now, tz);
        b?.in(86400 - sec);
        return s.days.includes(day);
    }
    return true;
}

/** When the current daily window ends (for "ends in 2 h" timers). */
export function windowEndsAt(
    s: GroupSchedule | null | undefined,
    now: Date,
    tz: string,
): string | null {
    if (!s) return null;
    const ends: number[] = [];
    if (s.endsAt) ends.push(new Date(s.endsAt).getTime());
    if (s.from && s.to) {
        const { sec } = local(now, tz);
        ends.push(
            now.getTime() +
                ((toSec(s.to) - sec + 86400) % 86400 || 86400) * 1000,
        );
    }
    return ends.length ? new Date(Math.min(...ends)).toISOString() : null;
}

/** When a group that is off now turns on next (null = never again / unknown). */
export function nextOpensAt(
    s: GroupSchedule | null | undefined,
    now: Date,
    tz: string,
): string | null {
    if (!s) return null;
    if (s.endsAt && new Date(s.endsAt) <= now) return null;
    let at =
        s.startsAt && new Date(s.startsAt) > now ? new Date(s.startsAt) : now;
    if (s.from && s.to) {
        // Look ahead up to 8 days for the next window start on an allowed day.
        for (let i = 0; i < 8; i++) {
            const { sec } = local(at, tz);
            const wait = (toSec(s.from) - sec + 86400) % 86400;
            const start = new Date(
                Math.floor(at.getTime() / 1000) * 1000 + wait * 1000,
            );
            if (!s.days?.length || s.days.includes(local(start, tz).day))
                return s.endsAt && start >= new Date(s.endsAt)
                    ? null
                    : start.toISOString();
            at = new Date(start.getTime() + 60_000);
        }
        return null;
    }
    return at > now ? at.toISOString() : null;
}
