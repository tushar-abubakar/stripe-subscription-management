/**
 * Forensic metadata for evidence-type uploads (support attachments, KYC,
 * invoices, delivery proof). Read from the ORIGINAL bytes before any
 * resize strips it, and stored in MediaFile.metadata so fraud reviews can
 * see: camera data, editing software, AI-generation markers, C2PA
 * credentials, PDF producer, and whether the same file was uploaded before.
 *
 * Heuristics, not proof: flags are hints for a human reviewer.
 */
import sharp from "sharp";

/** Software names that indicate an edited image. */
const EDITORS = [
    "photoshop", "lightroom", "gimp", "snapseed", "picsart", "canva", "pixlr", "affinity", "paint.net",
    "facetune", "meitu", "vsco", "photoroom", "remini", "inshot", "polarr", "fotor", "illustrator",
];

/** Generator names / markers that indicate an AI-generated image. */
const AI_MARKERS = [
    "midjourney", "dall-e", "dall·e", "dalle", "stable diffusion", "stablediffusion", "firefly", "imagen", "gemini",
    "openai", "chatgpt", "comfyui", "automatic1111", "novelai", "leonardo", "ideogram", "flux", "sdxl",
    "trainedalgorithmicmedia", "compositewithtrainedalgorithmicmedia", "ai generated", "ai-generated",
];

/** PDF producers that suggest an edited / regenerated invoice. */
const PDF_EDITORS = ["photoshop", "canva", "ilovepdf", "smallpdf", "sejda", "pdfescape", "word", "libreoffice", "foxit phantom", "nitro"];

export interface ForensicMeta {
    analyzedAt: string;
    kind: "image" | "document" | "other";
    format?: string | null;
    exif?: {
        make?: string;
        model?: string;
        software?: string;
        dateTime?: string;
        dateTimeOriginal?: string;
        gps: boolean;
    } | null;
    xmp?: { creatorTool?: string; digitalSourceType?: string; history?: boolean } | null;
    pngText?: string[];
    c2pa: boolean;
    pdf?: { producer?: string; creator?: string; creationDate?: string; modDate?: string; incrementalUpdates: number } | null;
    flags: {
        edited: boolean;
        aiSuspected: boolean;
        noCameraData: boolean;
        dateMismatch: boolean;
        hasGps: boolean;
        reused: boolean;
    };
    reasons: string[];
    /** 0 (clean) … 100 (very suspicious). */
    riskScore: number;
    /** Other uploads with the same SHA-256 (filled by MediaService). */
    reusedBy?: string[];
}

const hasAny = (text: string | undefined | null, words: string[]) => {
    const t = (text ?? "").toLowerCase();
    return !!t && words.some((w) => t.includes(w));
};

// ─── JSON-safe text ──────────────────────────────────────────────────────────

/**
 * Removes NUL and other control characters (tab / newline kept). File metadata is untrusted
 * bytes, and Postgres rejects `\u0000` in json / jsonb ("unsupported Unicode escape sequence").
 */
export const cleanText = (v: string) =>
    // eslint-disable-next-line no-control-regex
    v.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").trim();

/** Deep copy with every string (keys too) passed through `cleanText`; safe to store as jsonb. */
export function jsonSafe<T>(value: T): T {
    if (typeof value === "string") return cleanText(value) as T;
    if (Array.isArray(value)) return value.map((v) => jsonSafe(v)) as T;
    if (value && typeof value === "object" && !(value instanceof Date)) {
        return Object.fromEntries(
            Object.entries(value).map(([k, v]) => [cleanText(k), jsonSafe(v)]),
        ) as T;
    }
    return value;
}

// ─── EXIF (TIFF IFD) reader: only the few tags we need ───────────────────────

function readExif(buf: Buffer | undefined) {
    if (!buf || buf.length < 14) return null;
    // sharp returns the APP1 payload starting with "Exif\0\0"
    const start = buf.subarray(0, 6).toString("latin1") === "Exif\0\0" ? 6 : 0;
    const t = buf.subarray(start);
    if (t.length < 8) return null;
    const le = t.subarray(0, 2).toString("latin1") === "II";
    const u16 = (o: number) => (le ? t.readUInt16LE(o) : t.readUInt16BE(o));
    const u32 = (o: number) => (le ? t.readUInt32LE(o) : t.readUInt32BE(o));
    const out: Record<string, string | number> = {};
    const ascii = (count: number, valueOffset: number, entry: number) => {
        const off = count > 4 ? valueOffset : entry + 8;
        if (off + count > t.length) return "";
        // EXIF ASCII is NUL-terminated: anything after the first NUL is padding / garbage.
        return cleanText(t.subarray(off, off + count).toString("latin1").split("\0")[0]);
    };
    const readIfd = (offset: number, wanted: Record<number, string>) => {
        if (offset + 2 > t.length) return;
        const n = u16(offset);
        for (let i = 0; i < n && i < 200; i++) {
            const e = offset + 2 + i * 12;
            if (e + 12 > t.length) break;
            const tag = u16(e);
            const type = u16(e + 2);
            const count = u32(e + 4);
            const value = u32(e + 8);
            const name = wanted[tag];
            if (!name) continue;
            out[name] = type === 2 ? ascii(count, value, e) : value;
        }
    };
    try {
        const ifd0 = u32(4);
        readIfd(ifd0, { 0x010f: "make", 0x0110: "model", 0x0131: "software", 0x0132: "dateTime", 0x8769: "exifIfd", 0x8825: "gpsIfd" });
        if (typeof out.exifIfd === "number") readIfd(out.exifIfd, { 0x9003: "dateTimeOriginal" });
    } catch {
        return null;
    }
    return {
        make: (out.make as string) || undefined,
        model: (out.model as string) || undefined,
        software: (out.software as string) || undefined,
        dateTime: (out.dateTime as string) || undefined,
        dateTimeOriginal: (out.dateTimeOriginal as string) || undefined,
        gps: typeof out.gpsIfd === "number" && out.gpsIfd > 0,
    };
}

function readXmp(buf: Buffer | undefined) {
    if (!buf?.length) return null;
    const x = buf.toString("utf8");
    const pick = (re: RegExp) => x.match(re)?.[1];
    return {
        creatorTool: pick(/CreatorTool[=>"']+([^"'<]+)/i),
        digitalSourceType: pick(/DigitalSourceType[=>"']+([^"'<]+)/i),
        history: /stEvt:action|xmpMM:History/i.test(x),
    };
}

/** C2PA / content-credentials manifest (JUMBF box) present in the file. */
const hasC2pa = (bytes: Buffer) => {
    const head = bytes.subarray(0, Math.min(bytes.length, 2_000_000));
    return head.includes("c2pa") || head.includes("jumb");
};

function readPdf(bytes: Buffer) {
    const text = bytes.subarray(0, Math.min(bytes.length, 4_000_000)).toString("latin1");
    const field = (name: string) => {
        const m = text.match(new RegExp(`/${name}\\s*\\(([^)]{0,200})\\)`));
        return m?.[1]?.trim();
    };
    return {
        producer: field("Producer"),
        creator: field("Creator"),
        creationDate: field("CreationDate"),
        modDate: field("ModDate"),
        // Each extra %%EOF = an incremental save (edited after creation).
        incrementalUpdates: Math.max((text.match(/%%EOF/g)?.length ?? 1) - 1, 0),
    };
}

/** Analyse one file. Never throws: worst case returns an empty record. */
export async function analyzeForensics(bytes: Buffer, mime: string): Promise<ForensicMeta> {
    const meta: ForensicMeta = {
        analyzedAt: new Date().toISOString(),
        kind: mime.startsWith("image/") ? "image" : mime === "application/pdf" ? "document" : "other",
        c2pa: false,
        flags: { edited: false, aiSuspected: false, noCameraData: false, dateMismatch: false, hasGps: false, reused: false },
        reasons: [],
        riskScore: 0,
    };
    try {
        meta.c2pa = hasC2pa(bytes);
        if (meta.kind === "image") {
            const info = await sharp(bytes, { failOn: "none", limitInputPixels: 100_000_000 }).metadata();
            meta.format = info.format ?? null;
            meta.exif = readExif(info.exif);
            meta.xmp = readXmp(info.xmp);
            const comments = (info as { comments?: { keyword: string; text: string }[] }).comments ?? [];
            meta.pngText = comments.map((c) => `${c.keyword}: ${c.text}`.slice(0, 300));

            const software = [meta.exif?.software, meta.xmp?.creatorTool].filter(Boolean).join(" ");
            const allText = [software, meta.xmp?.digitalSourceType, ...(meta.pngText ?? [])].join(" ");

            if (hasAny(software, EDITORS) || meta.xmp?.history) {
                meta.flags.edited = true;
                meta.reasons.push(`Edited with ${software || "an editor (XMP history)"}`);
            }
            if (hasAny(allText, AI_MARKERS) || comments.some((c) => /parameters|prompt|negative prompt/i.test(c.keyword + c.text))) {
                meta.flags.aiSuspected = true;
                meta.reasons.push("AI-generation marker in metadata");
            }
            if (!meta.exif?.make && !meta.exif?.model) {
                meta.flags.noCameraData = true;
                meta.reasons.push("No camera make/model (screenshot, download or stripped metadata)");
            }
            if (meta.exif?.dateTime && meta.exif?.dateTimeOriginal && meta.exif.dateTime !== meta.exif.dateTimeOriginal) {
                meta.flags.dateMismatch = true;
                meta.reasons.push("Modified after it was taken (EXIF dates differ)");
            }
            meta.flags.hasGps = !!meta.exif?.gps;
        } else if (meta.kind === "document") {
            meta.pdf = readPdf(bytes);
            const tools = `${meta.pdf.producer ?? ""} ${meta.pdf.creator ?? ""}`;
            if (hasAny(tools, PDF_EDITORS) || meta.pdf.incrementalUpdates > 0) {
                meta.flags.edited = true;
                meta.reasons.push(
                    meta.pdf.incrementalUpdates > 0
                        ? `PDF saved ${meta.pdf.incrementalUpdates} more time(s) after creation`
                        : `PDF produced by ${tools.trim()}`,
                );
            }
            if (meta.pdf.creationDate && meta.pdf.modDate && meta.pdf.creationDate !== meta.pdf.modDate) {
                meta.flags.dateMismatch = true;
                meta.reasons.push("PDF modified after creation");
            }
            if (hasAny(tools, AI_MARKERS)) meta.flags.aiSuspected = true;
        }
    } catch {
        meta.reasons.push("Metadata could not be read");
    }
    meta.riskScore = score(meta.flags);
    return meta;
}

export function score(f: ForensicMeta["flags"]) {
    return Math.min(
        100,
        (f.aiSuspected ? 60 : 0) + (f.edited ? 30 : 0) + (f.reused ? 30 : 0) + (f.dateMismatch ? 15 : 0) + (f.noCameraData ? 10 : 0),
    );
}
