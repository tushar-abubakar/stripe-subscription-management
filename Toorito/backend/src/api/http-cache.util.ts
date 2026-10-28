import type { Request, Response } from "express";

export interface Cacheable<T> {
    body: T;
    /** Strong ETag ("…"). */
    etag?: string;
    ttlSec: number;
}

/**
 * HTTP caching of a response:
 * - `ETag` + `If-None-Match` → 304 with no body (the app keeps its copy),
 * - `Cache-Control: <scope>, max-age=<ttl>` so the app (and, for public scope, a CDN) reuses it without asking,
 *   plus stale-while-revalidate so a slightly old copy shows instantly while a fresh one loads,
 * - `Vary` on what changes the content.
 */
export function sendCached<T>(
    req: Request,
    res: Response,
    r: Cacheable<T>,
    opts: { scope?: "private" | "public"; swr?: number; vary?: string[] } = {},
): T | undefined {
    const scope = opts.scope ?? "private";
    res.setHeader(
        "Cache-Control",
        `${scope}, max-age=${Math.max(0, Math.floor(r.ttlSec))}, stale-while-revalidate=${opts.swr ?? 60}`,
    );
    res.setHeader(
        "Vary",
        (opts.vary ?? ["Authorization", "Accept-Language", "X-Device-Id"]).join(
            ", ",
        ),
    );
    if (r.etag) {
        res.setHeader("ETag", r.etag);
        const inm = req.headers["if-none-match"];
        if (
            inm &&
            (inm === "*" ||
                inm
                    .split(",")
                    .some((t) => t.trim().replace(/^W\//, "") === r.etag))
        ) {
            res.status(304);
            return undefined;
        }
    }
    return r.body;
}
