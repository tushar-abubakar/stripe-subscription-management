import sanitizeHtml from "sanitize-html";

/**
 * Rich-text helpers for admin-authored HTML (category / product descriptions).
 *
 * - `sanitizeRichText`   -> run on SAVE. Keeps a small, UI-safe tag set,
 *                           strips every style / class / id / on* attribute.
 * - `htmlToPlainText`    -> run on READ. Strips all tags, decodes entities,
 *                           collapses whitespace, optional word-safe truncation.
 *
 * Both have `...Map` variants for locale maps (`{ en: "...", ar: "..." }`).
 */

/**
 * Tags an admin may use. Deliberately no h1/h2 (page titles own those),
 * no img/iframe/table (break card layouts), no div/span (layout wrappers).
 */
export const RICH_TEXT_ALLOWED_TAGS = [
    // paragraphs + inline formatting
    "p",
    "br",
    "strong",
    "em",
    "u",
    "s",
    "sub",
    "sup",
    "code",
    // small section headings
    "h3",
    "h4",
    // lists
    "ul",
    "ol",
    "li",
    // quote
    "blockquote",
    // links
    "a",
] as const;

/** Absolute http(s), mailto, tel, site-relative ("/x", not "//x") or anchor. */
const SAFE_HREF = /^(?:https?:\/\/|mailto:|tel:|\/(?!\/)|#)/i;
const EXTERNAL_HREF = /^https?:\/\//i;

const RICH_TEXT_OPTIONS: sanitizeHtml.IOptions = {
    allowedTags: [...RICH_TEXT_ALLOWED_TAGS],
    // Only links carry attributes. No style / class / id / color anywhere.
    allowedAttributes: { a: ["href", "title", "target", "rel"] },
    allowedSchemes: ["http", "https", "mailto", "tel"],
    allowProtocolRelative: false,
    // Unknown tags are removed but their text is kept
    // (script / style / textarea content is dropped entirely).
    disallowedTagsMode: "discard",
    // Deeply nested markup is flattened instead of breaking the layout.
    nestingLimit: 6,
    transformTags: {
        // Normalize what editors / paste produce into the allowed set.
        b: "strong",
        i: "em",
        strike: "s",
        del: "s",
        ins: "u",
        h1: "h3",
        h2: "h3",
        h5: "h4",
        h6: "h4",
        div: "p",
        q: "blockquote",
        a: (tagName, attribs) => {
            const href = (attribs.href ?? "").trim();
            // Unsafe / empty link -> plain text (span is not allowed, so the
            // tag is discarded and only its text survives).
            if (!SAFE_HREF.test(href)) return { tagName: "span", attribs: {} };

            const external = EXTERNAL_HREF.test(href);
            return {
                tagName,
                attribs: {
                    href,
                    ...(attribs.title ? { title: attribs.title } : {}),
                    ...(external
                        ? { target: "_blank", rel: "noopener noreferrer nofollow" }
                        : {}),
                },
            };
        },
    },
};

/** Tags left empty after sanitizing (`<p></p>`, `<li><br /></li>`, ...). */
const EMPTY_TAG =
    /<(p|h3|h4|li|ul|ol|blockquote|strong|em|u|s|sub|sup|code|a)\b[^>]*>(?:\s|&nbsp;|<br\s*\/?>)*<\/\1>/gi;

/** Sanitizes admin HTML down to the allowed tag set. Returns "" when nothing meaningful is left. */
export function sanitizeRichText(html: string | null | undefined): string {
    if (!html?.trim()) return "";

    let out = sanitizeHtml(html, RICH_TEXT_OPTIONS);

    // At most two consecutive line breaks.
    out = out.replace(/(?:<br\s*\/?>\s*){3,}/gi, "<br /><br />");

    // Remove empty blocks; repeat so nested empties (<ul><li></li></ul>) collapse too.
    let prev: string;
    do {
        prev = out;
        out = out.replace(EMPTY_TAG, "");
    } while (out !== prev);

    out = out.trim();
    return htmlToPlainText(out) ? out : "";
}

/** `sanitizeRichText` for each language; empty languages are dropped. */
export function sanitizeRichTextMap(
    map: Record<string, string> | null | undefined,
): Record<string, string> | undefined {
    if (!map) return undefined;
    const out: Record<string, string> = {};
    for (const [lang, html] of Object.entries(map)) {
        const clean = sanitizeRichText(html);
        if (clean) out[lang] = clean;
    }
    return Object.keys(out).length ? out : undefined;
}

// ---------------------------------------------------------------------
// Plain text
// ---------------------------------------------------------------------

/** Block-level tags become a space so "<p>a</p><p>b</p>" -> "a b", not "ab". */
const BLOCK_BOUNDARY =
    /<\/?(?:p|div|br|li|ul|ol|h[1-6]|blockquote|tr|td|th|hr)\b[^>]*>/gi;

const NAMED_ENTITIES: Record<string, string> = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: '"',
    apos: "'",
    nbsp: " ",
};

function decodeEntities(text: string): string {
    return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, code: string) => {
        if (code[0] === "#") {
            const n =
                code[1] === "x" || code[1] === "X"
                    ? parseInt(code.slice(2), 16)
                    : parseInt(code.slice(1), 10);
            return Number.isFinite(n) && n > 0 && n <= 0x10ffff
                ? String.fromCodePoint(n)
                : match;
        }
        return NAMED_ENTITIES[code.toLowerCase()] ?? match;
    });
}

/** Cuts on a word boundary and appends "…". Counts code points, not UTF-16 units. */
function truncate(text: string, max: number): string {
    const chars = Array.from(text);
    if (chars.length <= max) return text;

    let cut = chars.slice(0, Math.max(1, max - 1)).join("");
    const space = cut.lastIndexOf(" ");
    if (space > cut.length * 0.6) cut = cut.slice(0, space);
    return `${cut.replace(/[\s.,;:!?\-–—]+$/u, "")}…`;
}

/** Strips all HTML and returns clean single-line text, optionally truncated. */
export function htmlToPlainText(
    html: string | null | undefined,
    maxLength?: number,
): string {
    if (!html) return "";
    const stripped = sanitizeHtml(html.replace(BLOCK_BOUNDARY, " "), {
        allowedTags: [],
        allowedAttributes: {},
    });
    const text = decodeEntities(stripped).replace(/\s+/g, " ").trim();
    return maxLength && maxLength > 0 ? truncate(text, maxLength) : text;
}

/** `htmlToPlainText` for each language of a stored JSON locale map. */
export function richTextMapToPlain(
    map: unknown,
    maxLength?: number,
): Record<string, string> | null {
    if (!map || typeof map !== "object" || Array.isArray(map)) return null;
    const out: Record<string, string> = {};
    for (const [lang, value] of Object.entries(map as Record<string, unknown>)) {
        if (typeof value !== "string") continue;
        const text = htmlToPlainText(value, maxLength);
        if (text) out[lang] = text;
    }
    return Object.keys(out).length ? out : null;
}
