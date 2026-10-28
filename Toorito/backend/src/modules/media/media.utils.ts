import { BadRequestException } from "@nestjs/common";
import { MediaPurpose } from "@prisma-client/enums";
import { randomUUID } from "crypto";
import {
    MediaKind,
    USER_SCOPED_PURPOSES,
} from "@modules/media/media.config";

/** Business-rule failure; the caller decides how to translate/map it. */
export class MediaRuleError extends Error {
    constructor(
        public readonly key: string,
        public readonly args?: Record<string, unknown>,
    ) {
        super(key);
    }
}

/** Detect the real type from magic bytes. Never trust client MIME. */
export function sniff(buf: Buffer): string | null {
    if (buf.length < 12) return null;
    const ascii = (a: number, b: number) => buf.subarray(a, b).toString("latin1");
    if (buf[0] === 0xff && buf[1] === 0xd8) return "image/jpeg";
    if (
        buf
            .subarray(0, 8)
            .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    )
        return "image/png";
    if (ascii(0, 4) === "RIFF") {
        if (ascii(8, 12) === "WEBP") return "image/webp";
        if (ascii(8, 12) === "WAVE") return "audio/wav";
        return null;
    }
    if (ascii(0, 4) === "%PDF") return "application/pdf";
    if (ascii(4, 8) === "ftyp") {
        const brand = ascii(8, 12);
        return brand === "M4A " || brand === "M4B " ? "audio/mp4" : "video/mp4";
    }
    if (ascii(0, 4) === "OggS") return "audio/ogg";
    if (ascii(0, 4) === "fLaC") return "audio/flac";
    if (ascii(0, 3) === "ID3") return "audio/mpeg";
    if (buf[0] === 0xff) {
        const b1 = buf[1]!;
        if ((b1 & 0xf6) === 0xf0) return "audio/aac"; // ADTS
        if ((b1 & 0xe0) === 0xe0 && ((b1 >> 1) & 3) !== 0) return "audio/mpeg"; // MPEG frame sync
    }
    return null;
}

export function safeFileName(raw: string | undefined, ext: string): string {
    const fallback = `file.${ext}`;
    if (!raw) return fallback;
    const decoded = Buffer.from(raw, "latin1").toString("utf8");
    let name = decoded.includes("\uFFFD") ? raw : decoded;
    name = name.normalize("NFKC");
    name = name.split(/[\\/]/).pop() ?? "";
    name = name.replace(/\.[^.]*$/, "");
    name = name
        .replace(/[^\p{L}\p{N}\p{M} ._()-]/gu, "")
        .replace(/\s+/g, " ")
        .replace(/\.{2,}/g, ".")
        .replace(/^[^\p{L}\p{N}]+/u, "")
        .trim()
        .slice(0, 100)
        .trim();
    return name ? `${name}.${ext}` : fallback;
}

/* ───────────── storage keys ───────────── */
const TYPE_DIR: Record<MediaKind, string> = {
    image: "images",
    video: "videos",
    audio: "audio",
    document: "documents",
};

export function buildKey(
    purpose: MediaPurpose,
    kind: MediaKind,
    userId: bigint | number | string,
    ext: string,
    variant?: "master" | "thumb",
) {
    const d = new Date();
    const parts = [purpose.toLowerCase(), TYPE_DIR[kind]];
    if (USER_SCOPED_PURPOSES.includes(purpose)) parts.push(`u-${userId}`);
    parts.push(
        String(d.getUTCFullYear()),
        String(d.getUTCMonth() + 1).padStart(2, "0"),
        `${randomUUID()}${variant ? `-${variant}` : ""}.${ext}`,
    );
    return parts.join("/");
}
export const buildTmpKey = (ext: string) => `tmp/${randomUUID()}.${ext}`;
export const isTmpKey = (key: string) => key.startsWith("tmp/");
/** Unverified temp originals are ALWAYS private, even for public purposes (never reachable via /static). */
export const storagePrivate = (key: string, rowPrivate: boolean) => rowPrivate || isTmpKey(key);

export function collectKeys(m: { key: string; variants?: unknown }): string[] {
    const v = (m.variants as Record<string, string> | null) ?? {};
    return [...new Set([m.key, ...Object.values(v)].filter(Boolean))];
}

/* ───────────── cursor ───────────── */
export const cursorEncode = (v: { id: string; createdAt: string }) =>
    Buffer.from(JSON.stringify(v)).toString("base64url");
export function cursorDecode(value?: string): { id: bigint; createdAt: Date } | null {
    if (!value) return null;
    try {
        const x = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
        if (!x?.id || !x?.createdAt) throw new Error();
        return { id: BigInt(x.id), createdAt: new Date(x.createdAt) };
    } catch {
        throw new BadRequestException("Invalid media cursor");
    }
}

/* ───────────── title / alt ───────────── */
export function assertLocaleMax(
    map: Record<string, string> | null | undefined,
    max: number,
    field: "title" | "alt",
) {
    for (const [lang, text] of Object.entries(map ?? {})) {
        if (typeof text === "string" && text.length > max)
            throw new MediaRuleError("media.text.tooLong", { field, lang, max });
    }
}
