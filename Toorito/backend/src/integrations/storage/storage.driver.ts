import type { Prisma } from "@prisma-client/client";
import { randomUUID } from "crypto";
import { promises as fs, createReadStream as fsCreateReadStream } from "fs";
import { dirname, resolve, sep } from "path";
import type { Readable } from "stream";

/**
 * Storage provider, derived from the Prisma schema (`MediaFile.provider`) so it
 * always matches the generated enum.
 */
export type StorageProvider = Prisma.MediaFileUncheckedCreateInput["provider"];

/** Direct-to-storage upload target (S3/R2/GCS presigned PUT/POST). Local driver does not implement it. */
export interface SignedUpload {
    url: string;
    method: "PUT" | "POST";
    headers?: Record<string, string>; // client must send these verbatim
    fields?: Record<string, string>; // S3 POST policy fields
    expiresAt: string;
}

/** Add S3 / R2 / GCS / Cloudinary / Bunny drivers by implementing this interface; DB stores provider+bucket+key only. */
export interface StorageDriver {
    readonly provider: StorageProvider;
    put(
        key: string,
        data: Buffer,
        mime: string,
        isPrivate: boolean,
    ): Promise<void>;
    remove(key: string, isPrivate: boolean): Promise<void>;
    /** @throws StorageNotFoundError when the object does not exist. */
    read(key: string, isPrivate: boolean): Promise<Buffer>;
    /** Public URL (CDN-ready). Private files are streamed through the API. */
    url(key: string): string;

    /** @throws StorageNotFoundError. S3: HeadObject. */
    head(key: string, isPrivate: boolean): Promise<{ size: number }>;
    /** Inclusive byte range. S3: GetObject with Range. */
    readRange(
        key: string,
        isPrivate: boolean,
        start: number,
        end: number,
    ): Promise<Buffer>;
    /** Streaming read, optional inclusive range. @throws StorageNotFoundError. */
    createReadStream(
        key: string,
        isPrivate: boolean,
        range?: { start: number; end: number },
    ): Promise<Readable>;
    /** Optional. When absent, MediaService falls back to proxy upload through the API. */
    createSignedUpload?(opts: {
        key: string;
        mimeType: string;
        maxBytes: number;
        isPrivate: boolean;
        expiresInSec: number;
    }): Promise<SignedUpload>;
}
export const STORAGE_DRIVER = Symbol("STORAGE_DRIVER");

/**
 * Base error for storage drivers.
 *
 * Drivers are plain classes (no DI), so they cannot translate messages.
 * Instead they carry an i18n key + args, and `MediaService` translates them
 * with `I18nService`. `message` is the key itself (for logs only).
 */
export class StorageError extends Error {
    constructor(
        readonly i18nKey: string,
        readonly args?: Record<string, unknown>,
    ) {
        super(i18nKey);
        this.name = new.target.name;
    }
}

/** Thrown by drivers when a requested object does not exist. */
export class StorageNotFoundError extends StorageError {
    constructor() {
        super("media.notFound");
    }
}

const isEnoent = (e: unknown) =>
    (e as NodeJS.ErrnoException)?.code === "ENOENT";

export class LocalStorageDriver implements StorageDriver {
    readonly provider: StorageProvider = "LOCAL";
    private readonly root: string;

    /**
     * @param dir - Base storage directory. Files live in `{dir}/public` and `{dir}/private`.
     * @param baseUrl - Public URL that maps to `{dir}/public` (static route or CDN).
     */
    constructor(
        dir: string,
        private baseUrl: string,
    ) {
        this.root = resolve(dir);
    }

    /** Directory to expose as static files (never expose `private`). */
    publicDir() {
        return resolve(this.root, "public");
    }

    /** Rejects keys that could escape the storage root. */
    private static assertKey(key: string) {
        if (
            !key ||
            key.length > 512 ||
            key.includes("\0") ||
            key.includes("\\") ||
            key.startsWith("/") ||
            key.split("/").some((s) => s === "" || s === "." || s === "..")
        ) {
            throw new StorageError("storage.key.invalid");
        }
    }

    /** Resolves a key inside the public or private root (containment checked per root). */
    private path(key: string, priv: boolean) {
        LocalStorageDriver.assertKey(key);
        const base = resolve(this.root, priv ? "private" : "public");
        const p = resolve(base, key);
        if (!p.startsWith(base + sep))
            throw new StorageError("storage.key.invalid");
        return p;
    }

    /** Writes atomically (temp file + rename) so readers never see partial files. */
    async put(key: string, data: Buffer, _mime: string, priv: boolean) {
        const p = this.path(key, priv);
        await fs.mkdir(dirname(p), { recursive: true });
        const tmp = `${p}.${randomUUID()}.tmp`;
        try {
            await fs.writeFile(tmp, data, {
                flag: "wx",
                mode: priv ? 0o600 : 0o644,
            });
            await fs.rename(tmp, p);
        } catch (e) {
            await fs.rm(tmp, { force: true });
            throw e;
        }
    }

    async remove(key: string, priv: boolean) {
        await fs.rm(this.path(key, priv), { force: true });
    }

    async read(key: string, priv: boolean) {
        try {
            return await fs.readFile(this.path(key, priv));
        } catch (e) {
            if (isEnoent(e)) throw new StorageNotFoundError();
            throw e;
        }
    }

    async head(key: string, priv: boolean) {
        try {
            const st = await fs.stat(this.path(key, priv));
            if (!st.isFile()) throw new StorageNotFoundError();
            return { size: st.size };
        } catch (e) {
            if (isEnoent(e)) throw new StorageNotFoundError();
            throw e;
        }
    }

    async readRange(key: string, priv: boolean, start: number, end: number) {
        let fh: fs.FileHandle | undefined;
        try {
            fh = await fs.open(this.path(key, priv), "r");
            const len = Math.max(end - start + 1, 0);
            const buf = Buffer.alloc(len);
            const { bytesRead } = await fh.read(buf, 0, len, start);
            return buf.subarray(0, bytesRead);
        } catch (e) {
            if (isEnoent(e)) throw new StorageNotFoundError();
            throw e;
        } finally {
            await fh?.close();
        }
    }

    async createReadStream(
        key: string,
        priv: boolean,
        range?: { start: number; end: number },
    ): Promise<Readable> {
        await this.head(key, priv); // throws StorageNotFoundError up-front instead of a late stream error
        return fsCreateReadStream(this.path(key, priv), range);
    }

    url(key: string) {
        const safe = key.split("/").map(encodeURIComponent).join("/");
        return `${this.baseUrl.replace(/\/+$/, "")}/${safe}`;
    }
}
