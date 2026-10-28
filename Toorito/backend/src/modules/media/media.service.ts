import { MEDIA_ROUTES } from "./media.routes";
import { AuthUser } from "@common/types/auth.type";
import { AppConfig } from "@config/config.type";
import type { ImageProfileConfig } from "@config/mediaProfile.const";
import { PrismaService } from "@core/database/prisma.service";
import { LocaleService } from "@core/locale/locale.service";
import {
    STORAGE_DRIVER,
    StorageDriver,
    StorageError,
    StorageNotFoundError,
} from "@integrations/storage/storage.driver";
import { analyzeForensics, jsonSafe, score } from "./media-forensics";
import { inspectImage, renderVariants } from "./media-image";
import { MediaProcessor } from "./media-processor.service";
import { MediaUsageService } from "./media-usage.service";
import {
    ADMINS,
    buildProfileMap,
    canonicalMime,
    CATALOG_PURPOSES,
    EVIDENCE_PURPOSES,
    LIBRARY_HIDDEN_PURPOSES,
    DEDICATED_UPLOAD_PURPOSES,
    KIND_TO_TYPE,
    MEDIA_PURPOSE_ROLES,
    MediaKind,
    MIME_INFO,
    minDimensions,
    PRIVATE_PURPOSES,
    PRIVATE_READERS_BY_PURPOSE,
    ProfileMap,
    PURPOSE_KINDS,
    resolveMaxUploadBytes,
    TYPE_TO_KIND,
    USER_SCOPED_PURPOSES,
    VIDEO_ROLES,
} from "./media.config";
import {
    MediaFilterInput,
    MediaListQueryInput,
    MediaSummaryQueryInput,
} from "./media.types";
import {
    assertLocaleMax,
    buildKey,
    buildTmpKey,
    collectKeys,
    cursorDecode,
    cursorEncode,
    MediaRuleError,
    safeFileName,
    sniff,
    storagePrivate,
} from "./media.utils";
import {
    BadRequestException,
    ConflictException,
    ForbiddenException,
    Inject,
    Injectable,
    InternalServerErrorException,
    Logger,
    NotFoundException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Prisma } from "@prisma-client/client";
import {
    MediaPurpose,
    MediaStatus,
    MediaType,
    UserRole,
} from "@prisma-client/enums";
import { createHash } from "crypto";
import { I18nService } from "nestjs-i18n";
import type { Readable } from "stream";
export { MEDIA_PURPOSE_ROLES, resolveMaxUploadBytes }; // keep old import path working
export interface UploadedFile {
    originalname: string;
    mimetype?: string;
    size: number;
    buffer: Buffer;
}
export type MediaVariant = "master" | "thumb";
type Row = Prisma.MediaFileGetPayload<object>;
type Texts = Record<string, string> | undefined;
const sha256 = (b: Buffer) => createHash("sha256").update(b).digest("hex");
const mb = (bytes: number) => Math.round((bytes / 1024 / 1024) * 10) / 10;
@Injectable()
export class MediaService {
    private readonly log = new Logger(MediaService.name);
    private readonly cfg: AppConfig["media"];
    private readonly profiles: ProfileMap;
    constructor(
        private readonly prisma: PrismaService,
        @Inject(STORAGE_DRIVER) private readonly driver: StorageDriver,
        private readonly i18n: I18nService,
        config: ConfigService,
        private readonly locale: LocaleService,
        private readonly usage: MediaUsageService,
        private readonly processor: MediaProcessor,
    ) {
        this.cfg = config.getOrThrow<AppConfig["media"]>("media");
        this.profiles = buildProfileMap(this.cfg.purposes);
    }
    /* ───────────────────────── helpers ───────────────────────── */
    private t = (key: string, args?: Record<string, unknown>) =>
        this.i18n.translate(key, { args });
    private bad = (key: string, args?: Record<string, unknown>) =>
        new BadRequestException(this.t(key, args));
    private fromRule = (e: MediaRuleError) => this.bad(e.key, e.args);
    private async io<T>(fn: () => Promise<T>): Promise<T> {
        try {
            return await fn();
        } catch (e) {
            if (e instanceof StorageNotFoundError)
                throw new NotFoundException(this.i18n.translate(e.i18nKey));
            if (e instanceof StorageError)
                throw new InternalServerErrorException(
                    this.i18n.translate(e.i18nKey, { args: e.args }),
                );
            throw e;
        }
    }
    private profileOf = (p: MediaPurpose) => this.profiles[p] ?? null;
    private limitFor = (k: MediaKind) => this.cfg[k].maxBytes;
    private uploadKey = (m: Row) => m.key; // tmp original until READY, final key otherwise
    /** Storage visibility for the row's CURRENT key (tmp originals are always private). */
    private priv = (m: Row) => storagePrivate(m.key, m.isPrivate);
    private async mustFind(id: bigint): Promise<Row> {
        const m = await this.prisma.mediaFile.findFirst({
            where: { id, deletedAt: null },
        });
        if (!m) throw new NotFoundException(this.t("media.notFound"));
        return m;
    }
    private assertOwnerOrAdmin(m: Row, user: AuthUser) {
        if (m.uploadedById !== user.id && !ADMINS.includes(user.role))
            throw new ForbiddenException(this.t("media.access.forbidden"));
    }
    /**
     * Library visibility (list, summary, details, usage):
     * admins see everything; anyone sees their own uploads; store managers
     * also see catalog media. Avatars of other users are never shown.
     */
    private async canViewInLibrary(m: Pick<Row, "id" | "uploadedById" | "purpose" | "isPrivate">, user: AuthUser) {
        if (ADMINS.includes(user.role)) return true;
        // Supplier invoices: the store manager sees every invoice of their store (uploaded by the store's team or attached to its GRNs).
        if (m.purpose === MediaPurpose.INVOICE)
            return user.role === UserRole.STORE_MANAGER && (await this.isStoreInvoice(m, user));
        // Otherwise only their own uploads, and never support / KYC / delivery-proof evidence.
        return m.uploadedById === user.id && !EVIDENCE_PURPOSES.includes(m.purpose);
    }

    /** Invoice belongs to the user's store: uploaded by a member of the store, or attached to one of its goods receipts. */
    private async isStoreInvoice(m: Pick<Row, "id" | "uploadedById">, user: AuthUser) {
        if (!user.storeId) return false;
        if (m.uploadedById === user.id) return true;
        const rows = await this.prisma.$queryRaw<unknown[]>`
            SELECT 1 FROM "User" u WHERE u.id = ${m.uploadedById} AND u."storeId" = ${user.storeId}
            UNION ALL
            SELECT 1 FROM "GoodsReceipt" g
            WHERE g."storeId" = ${user.storeId} AND g."invoiceMediaIds" @> ${JSON.stringify([Number(m.id)])}::jsonb
            LIMIT 1`;
        return rows.length > 0;
    }

    /**
     * Private file access. Admins: everything. Others: the purpose's reader
     * roles, narrowed to their own store / own documents:
     * - KYC: the member the document belongs to; the uploader (manager onboarding) only while it is a draft.
     * - SUPPORT: the uploader, or store manager / staff of the ticket's store.
     * - INVOICE: the store's manager (any invoice of the store) and the uploader; other staff can't open it.
     */
    private async assertCanReadPrivate(m: Row, user: AuthUser) {
        if (ADMINS.includes(user.role)) return;
        const deny = () => {
            throw new ForbiddenException(this.t("media.access.forbidden"));
        };
        if (m.purpose === MediaPurpose.KYC) {
            const docs = await this.prisma.kycDocument.findMany({
                where: { OR: [{ frontMediaId: m.id }, { backMediaId: m.id }] },
                select: { userId: true, uploadedById: true, submittedAt: true, removedAt: true },
            });
            // Not attached yet: only the uploader (preview before adding it).
            if (!docs.length) return m.uploadedById === user.id ? undefined : deny();
            // The person the document belongs to, always.
            if (docs.some((d) => d.userId === user.id)) return;
            // The uploader (store manager onboarding a member) only while it is still a DRAFT.
            if (docs.some((d) => d.uploadedById === user.id && !d.submittedAt && !d.removedAt)) return;
            return deny();
        }
        if (m.uploadedById === user.id) return;
        if (!(PRIVATE_READERS_BY_PURPOSE[m.purpose] ?? ADMINS).includes(user.role)) return deny();
        if (!user.storeId) return deny();
        const asJson = JSON.stringify([Number(m.id)]);
        if (m.purpose === MediaPurpose.SUPPORT) {
            const rows = await this.prisma.$queryRaw<unknown[]>`
                SELECT 1 FROM "SupportMessage" sm JOIN "SupportTicket" st ON st.id = sm."ticketId"
                WHERE st."storeId" = ${user.storeId} AND sm."attachmentIds" @> ${asJson}::jsonb LIMIT 1`;
            if (rows.length) return;
            const ret = await this.prisma.$queryRaw<unknown[]>`
                SELECT 1 FROM "ApprovalRequest" ar
                WHERE ar."storeId" = ${user.storeId} AND ar.payload->'mediaIds' @> ${asJson}::jsonb LIMIT 1`;
            return ret.length ? undefined : deny();
        }
        if (m.purpose === MediaPurpose.INVOICE) {
            return (await this.isStoreInvoice(m, user)) ? undefined : deny();
        }
        if (m.purpose === MediaPurpose.DELIVERY_PROOF) {
            const rows = await this.prisma.$queryRaw<unknown[]>`
                SELECT 1 FROM "Delivery" d JOIN "Order" o ON o.id = d."orderId"
                WHERE o."storeId" = ${user.storeId} AND d."proofMediaId" = ${m.id} LIMIT 1`;
            return rows.length ? undefined : deny();
        }
    }

    /** Forensic record for evidence uploads, with SHA-256 reuse detection. */
    private async forensics(row: Row, bytes: Buffer, mime: string, checksum: string) {
        const meta = await analyzeForensics(bytes, mime);
        const same = await this.prisma.mediaFile.findMany({
            where: { checksum, deletedAt: null, NOT: { id: row.id } },
            select: { id: true },
            orderBy: { id: "desc" },
            take: 5,
        });
        if (same.length) {
            meta.flags.reused = true;
            meta.reusedBy = same.map((m) => m.id.toString());
            meta.reasons.push(`Same file uploaded before (${same.length}x)`);
            meta.riskScore = score(meta.flags);
        }
        // EXIF / XMP / PDF strings come straight from the file: strip NULs before jsonb.
        return jsonSafe(meta) as unknown as Prisma.InputJsonValue;
    }
    private async assertCanViewInLibrary(m: Row, user: AuthUser) {
        if (!(await this.canViewInLibrary(m, user)))
            throw new ForbiddenException(this.t("media.access.forbidden"));
    }
    /** Edit / replace / delete: admins any file, everyone else only files they uploaded. */
    private canModify(m: Pick<Row, "uploadedById">, user: AuthUser) {
        return ADMINS.includes(user.role) || m.uploadedById === user.id;
    }
    private assertCanModify(m: Row, user: AuthUser) {
        if (!this.canModify(m, user))
            throw new ForbiddenException(this.t("media.access.notOwner"));
    }
    private assertKindAllowed(
        kind: MediaKind,
        purpose: MediaPurpose,
        role: AuthUser["role"],
    ) {
        if (!PURPOSE_KINDS[purpose].includes(kind))
            throw this.bad("media.kind.notAllowedForPurpose", {
                kind,
                purpose,
            });
        if (kind === "video" && !VIDEO_ROLES.includes(role))
            throw this.bad("media.video.notAllowed");
        // Store managers add catalog photos only; video / audio stay with admins.
        if (kind !== "image" && CATALOG_PURPOSES.includes(purpose) && !ADMINS.includes(role))
            throw this.bad("media.kind.imagesOnly");
    }
    private assertSize(kind: MediaKind, size: number) {
        if (size < 1) throw this.bad("media.file.required");
        const max = this.limitFor(kind);
        if (size > max)
            throw this.bad("media.file.tooLarge", { maxMb: mb(max) });
    }
    private cleanTexts(title: Texts, alt: Texts) {
        const t = this.locale.cleanMap(title, "title", true) ?? null;
        const a = this.locale.cleanMap(alt, "alt", false) ?? null;
        try {
            assertLocaleMax(t, this.cfg.text.titleMaxLen, "title");
            assertLocaleMax(a, this.cfg.text.altMaxLen, "alt");
        } catch (e) {
            if (e instanceof MediaRuleError) throw this.fromRule(e);
            throw e;
        }
        return { title: t, alt: a };
    }
    /* ───────────────────────── urls / presenters ───────────────────────── */
    private fileUrl(id: bigint, variant: MediaVariant = "master") {
        return `${MEDIA_ROUTES.file(id)}?variant=${variant}`;
    }
    /** Direct public URL of the master file. Private media has no public URL. */
    urlOf(m: { key: string; variants?: unknown; isPrivate: boolean }) {
        return this.urlForVariant(m, "master");
    }

    urlForKey(key?: string | null) {
        return key ? this.driver.url(key) : null;
    }

    /**
     * Direct public URL (no API hop). Returns null for private media.
     * Thumbnail missing -> master -> key.
     */
    urlForVariant(
        media: { key: string; isPrivate: boolean; variants?: unknown },
        variant: MediaVariant = "master",
    ) {
        if (media.isPrivate) return null;

        const variants = media.variants as Record<string, string> | null;
        const key = variants?.[variant] ?? variants?.master ?? media.key;

        // A tmp original (PENDING/PROCESSING) is always private: no public URL yet.
        if (storagePrivate(key, media.isPrivate)) return null;

        return this.driver.url(key);
    }

    private present(m: Row) {
        const ready = m.status === MediaStatus.READY;
        return {
            id: m.id.toString(),
            status: m.status,
            failureReason:
                m.status === MediaStatus.FAILED ? m.failureReason : null,
            title: m.title,
            alt: m.alt,
            originalName: m.originalName,
            mimeType: m.mimeType,
            size: m.sizeBytes,
            width: m.width,
            height: m.height,
            purpose: m.purpose,
            uploadedById: m.uploadedById.toString(),
            type: m.type,
            isPrivate: m.isPrivate,
            variants:
                ready && m.type === MediaType.IMAGE
                    ? {
                          thumb: this.urlForVariant(m, "thumb"),
                          master: this.urlForVariant(m, "master"),
                      }
                    : null,
            url: ready ? this.urlOf(m) : null,
            accessUrl: ready && m.isPrivate ? MEDIA_ROUTES.file(m.id) : null,
            createdAt: m.createdAt,
        };
    }
    /** Purposes this user may upload through the library (avatars use PUT /account/avatar). */
    allowedPurposes(user: AuthUser) {
        return Object.values(MediaPurpose).filter(
            (p) =>
                MEDIA_PURPOSE_ROLES[p].includes(user.role) &&
                !DEDICATED_UPLOAD_PURPOSES.includes(p),
        );
    }
    /** What the client needs to validate BEFORE uploading: min size, auto-crop target, fit. */
    private imageRules(p: ImageProfileConfig | null) {
        if (!p) return null;
        const min = minDimensions(p);
        return {
            fit: p.master.fit,
            targetWidth: p.master.width,
            targetHeight: p.master.height,
            minWidth: min?.width ?? null,
            minHeight: min?.height ?? null,
            thumbnail: { width: p.thumbnail.width, height: p.thumbnail.height },
        };
    }
    purposeMatrix() {
        return Object.fromEntries(
            Object.values(MediaPurpose).map((p) => [
                p,
                {
                    roles: MEDIA_PURPOSE_ROLES[p],
                    kinds: PURPOSE_KINDS[p],
                    isPrivate: PRIVATE_PURPOSES.includes(p),
                    readers: PRIVATE_PURPOSES.includes(p)
                        ? (PRIVATE_READERS_BY_PURPOSE[p] ?? ADMINS)
                        : null,
                    maxBytes: Object.fromEntries(
                        PURPOSE_KINDS[p].map((k) => [k, this.limitFor(k)]),
                    ),
                    image: this.imageRules(this.profileOf(p)),
                },
            ]),
        );
    }
    /* ───────────────────────── CREATE: step 1 (init) ───────────────────────── */
    private async createPending(
        i: {
            purpose: MediaPurpose;
            fileName?: string;
            mime: string;
            size: number;
            title?: Texts;
            alt?: Texts;
        },
        user: AuthUser,
        opts: { dedicated?: boolean } = {},
    ): Promise<Row> {
        const { purpose } = i;
        if (!Object.values(MediaPurpose).includes(purpose))
            throw this.bad("media.purpose.invalid");
        if (DEDICATED_UPLOAD_PURPOSES.includes(purpose) && !opts.dedicated)
            throw this.bad("media.avatar.useProfile");
        if (!MEDIA_PURPOSE_ROLES[purpose].includes(user.role))
            throw new ForbiddenException(this.t("media.upload.forbidden"));
        const mime = canonicalMime(i.mime);
        const info = MIME_INFO[mime];
        if (!info) throw this.bad("media.file.unsupported");
        this.assertKindAllowed(info.kind, purpose, user.role);
        this.assertSize(info.kind, i.size);
        const profile = info.kind === "image" ? this.profileOf(purpose) : null; // KYC → null → original preserved
        const key = profile
            ? buildTmpKey(info.ext)
            : buildKey(purpose, info.kind, user.id, info.ext);
        const { title, alt } = this.cleanTexts(i.title, i.alt);
        const originalName = safeFileName(i.fileName, info.ext);
        return this.prisma.mediaFile.create({
            data: {
                purpose,
                type: KIND_TO_TYPE[info.kind],
                status: MediaStatus.PENDING,
                provider: this.driver.provider,
                bucket: this.cfg.bucket,
                key,
                originalName,
                title: title ?? Prisma.JsonNull,
                alt: alt ?? Prisma.JsonNull,
                mimeType: mime,
                sizeBytes: i.size,
                isPrivate: PRIVATE_PURPOSES.includes(purpose),
                uploadedById: user.id,
            },
        });
    }
    async initUpload(
        dto: {
            purpose: MediaPurpose;
            fileName: string;
            mimeType: string;
            size: number;
            title?: Texts;
            alt?: Texts;
        },
        user: AuthUser,
    ) {
        const row = await this.createPending(
            { ...dto, mime: dto.mimeType },
            user,
        );
        const ttl = this.cfg.jobs.uploadUrlTtlSec;
        const signed = this.driver.createSignedUpload
            ? await this.io(() =>
                  this.driver.createSignedUpload!({
                      key: this.uploadKey(row),
                      mimeType: row.mimeType,
                      maxBytes: row.sizeBytes,
                      isPrivate: this.priv(row),
                      expiresInSec: ttl,
                  }),
              )
            : null;
        return {
            id: row.id.toString(),
            status: row.status,
            maxBytes: row.sizeBytes,
            upload: signed
                ? { mode: "direct", ...signed }
                : {
                      mode: "proxy",
                      method: "PUT",
                      url: MEDIA_ROUTES.uploadContent(row.id),
                      field: "file",
                  },
            rules: {
                maxBytes: this.limitFor(TYPE_TO_KIND[row.type]),
                image:
                    row.type === MediaType.IMAGE
                        ? this.imageRules(this.profileOf(row.purpose))
                        : null,
                video:
                    row.type === MediaType.VIDEO
                        ? (this.cfg.purposes[row.purpose].video ?? null)
                        : null,
                audio:
                    row.type === MediaType.AUDIO
                        ? (this.cfg.purposes[row.purpose].audio ?? null)
                        : null,
            },
            completeUrl: MEDIA_ROUTES.uploadComplete(row.id),
            statusUrl: MEDIA_ROUTES.status(row.id),
            expiresAt: new Date(Date.now() + ttl * 1000).toISOString(),
        };
    }
    /** Proxy upload for drivers without signed URLs (LOCAL). */
    async receiveContent(id: bigint, file: UploadedFile, user: AuthUser) {
        const row = await this.mustFind(id);
        this.assertOwnerOrAdmin(row, user);
        if (row.status !== MediaStatus.PENDING)
            throw new ConflictException(
                this.t("media.upload.alreadyCompleted"),
            );
        if (!file?.buffer?.length) throw this.bad("media.file.required");
        if (file.buffer.length > row.sizeBytes)
            throw this.bad("media.file.tooLarge", { maxMb: mb(row.sizeBytes) });
        await this.io(() =>
            this.driver.put(
                this.uploadKey(row),
                file.buffer,
                row.mimeType,
                this.priv(row),
            ),
        );
        return { id: row.id.toString(), status: row.status };
    }
    /** One-shot multipart (kept for simple clients): init + put + complete. */
    async upload(
        file: UploadedFile,
        dto: { purpose: MediaPurpose; title?: Texts; alt?: Texts },
        user: AuthUser,
        opts: { dedicated?: boolean } = {},
    ) {
        if (!file?.buffer?.length) throw this.bad("media.file.required");
        const mime = sniff(file.buffer);
        if (!mime) throw this.bad("media.file.unsupported");
        const row = await this.createPending(
            {
                ...dto,
                fileName: file.originalname,
                mime,
                size: file.buffer.length,
            },
            user,
            opts,
        );
        try {
            await this.io(() =>
                this.driver.put(
                    this.uploadKey(row),
                    file.buffer,
                    mime,
                    this.priv(row),
                ),
            );
        } catch (e) {
            await this.discard(row).catch(() => undefined);
            throw e;
        }
        return this.complete(row.id, user, file.buffer);
    }
    /* ───────────────────────── CREATE: step 2 (verify + queue) ───────────────────────── */
    async complete(id: bigint, user: AuthUser, preloaded?: Buffer) {
        const row = await this.mustFind(id);
        this.assertOwnerOrAdmin(row, user);
        if (row.status !== MediaStatus.PENDING) return this.present(row); // idempotent
        const kind = TYPE_TO_KIND[row.type];
        const key = this.uploadKey(row);
        try {
            const head = await this.io(() =>
                this.driver.head(key, this.priv(row)),
            );
            if (!head.size) throw new MediaRuleError("media.file.required");
            const max = this.limitFor(kind);
            if (head.size > max || head.size > row.sizeBytes)
                throw new MediaRuleError("media.file.tooLarge", {
                    maxMb: mb(Math.min(max, row.sizeBytes)),
                });
            const first =
                preloaded ??
                (await this.io(() =>
                    this.driver.readRange(key, this.priv(row), 0, 31),
                ));
            const mime = sniff(first);
            if (!mime || MIME_INFO[mime]?.kind !== kind)
                throw new MediaRuleError("media.file.unsupported");
            const profile =
                kind === "image" ? this.profileOf(row.purpose) : null;
            let width: number | null = null;
            let height: number | null = null;
            let checksum: string;
            let forensic: Prisma.InputJsonValue | undefined;
            if (kind === "image") {
                const buf =
                    preloaded ??
                    (await this.io(() =>
                        this.driver.read(key, this.priv(row)),
                    ));
                ({ width, height } = await inspectImage(buf, profile)); // too-small → error NOW, not async
                checksum = sha256(buf);
                if (EVIDENCE_PURPOSES.includes(row.purpose))
                    forensic = await this.forensics(row, buf, mime, checksum);
            } else {
                checksum = preloaded
                    ? sha256(preloaded)
                    : await this.hashObject(key, this.priv(row));
                if (EVIDENCE_PURPOSES.includes(row.purpose)) {
                    const bytes = preloaded ?? (await this.io(() => this.driver.read(key, this.priv(row))));
                    forensic = await this.forensics(row, bytes, mime, checksum);
                }
            }
            if (!row.isPrivate) {
                const dup = await this.prisma.mediaFile.findFirst({
                    where: {
                        checksum,
                        purpose: row.purpose,
                        isPrivate: false,
                        deletedAt: null,
                        status: MediaStatus.READY,
                        ...(USER_SCOPED_PURPOSES.includes(row.purpose)
                            ? { uploadedById: row.uploadedById }
                            : {}),
                        NOT: { id },
                    },
                });
                if (dup) {
                    await this.discard(row);
                    return this.present(dup);
                }
            }
            const needsProcessing = kind === "image" && !!profile;
            const res = await this.prisma.mediaFile.updateMany({
                where: { id, status: MediaStatus.PENDING },
                data: {
                    mimeType: mime,
                    sizeBytes: head.size,
                    checksum,
                    width,
                    height,
                    ...(forensic !== undefined ? { metadata: forensic } : {}),
                    attempts: 0,
                    lockedAt: null,
                    ...(needsProcessing
                        ? { status: MediaStatus.PROCESSING }
                        : {
                              status: MediaStatus.READY,
                              variants: { master: row.key },
                          }),
                },
            });
            const fresh = await this.mustFind(id);
            if (res.count && needsProcessing) this.processor.kick();
            return this.present(fresh);
        } catch (e) {
            if (e instanceof MediaRuleError) {
                await this.discard(row).catch((err) =>
                    this.log.warn(`discard failed: ${err}`),
                );
                throw this.fromRule(e);
            }
            throw e;
        }
    }
    private async hashObject(key: string, isPrivate: boolean) {
        const stream = await this.io(() =>
            this.driver.createReadStream(key, isPrivate),
        );
        const h = createHash("sha256");
        for await (const chunk of stream) h.update(chunk as Buffer);
        return h.digest("hex");
    }
    /** Delete every storage object of a row (missing objects are fine). */
    async purgeObjects(row: Row) {
        for (const k of collectKeys(row)) {
            try {
                await this.driver.remove(k, storagePrivate(k, row.isPrivate));
            } catch (e) {
                if (!(e instanceof StorageNotFoundError)) throw e;
            }
        }
    }
    /** Hard-delete a never-used row (abandoned / invalid / failed): objects first, then the row, so a retry is always safe. */
    async discard(row: Row) {
        if ((await this.usage.detail(row.id)).total > 0) return;
        await this.purgeObjects(row);
        await this.prisma.mediaFile
            .delete({ where: { id: row.id } })
            .catch(() => undefined);
    }
    /* ───────────────────────── READ ───────────────────────── */
    async status(id: bigint, user: AuthUser) {
        const m = await this.mustFind(id);
        this.assertOwnerOrAdmin(m, user);
        return {
            ...this.present(m),
            attempts: m.attempts,
            progress: await this.progress(m),
        };
    }
    /** Server-side stage + ETA. Byte-level upload progress/ETA is measured by the client (XHR/fetch upload events). */
    private async progress(m: Row) {
        if (m.status === MediaStatus.PROCESSING) {
            const ahead = await this.prisma.mediaFile.count({
                where: {
                    status: MediaStatus.PROCESSING,
                    deletedAt: null,
                    id: { lt: m.id },
                },
            });
            return {
                stage: "processing",
                percent: 80,
                queuePosition: ahead + 1,
                etaSec: (ahead + 1) * 3,
                pollAfterMs: 1000,
            };
        }
        if (m.status === MediaStatus.PENDING)
            return {
                stage: "awaiting_upload",
                percent: 10,
                queuePosition: null,
                etaSec: null,
                pollAfterMs: 2000,
            };
        return {
            stage: m.status === MediaStatus.READY ? "done" : "failed",
            percent: 100,
            queuePosition: null,
            etaSec: 0,
            pollAfterMs: null,
        };
    }
    /** Details for the library; visibility as in list(). */
    async get(id: bigint, user: AuthUser) {
        const m = await this.mustFind(id);
        await this.assertCanViewInLibrary(m, user);
        return { ...this.present(m), canEdit: this.canModify(m, user) };
    }
    /** Ids matching title/alt (any language) / filename and usage filters. Capped; narrow with other filters for huge libraries. */
    private async matchingIds(
        f: Pick<MediaFilterInput, "q" | "unused" | "usedIn">,
    ) {
        const q = f.q?.trim();
        if (!q && f.unused === undefined && !f.usedIn) return undefined;
        const w: Prisma.Sql[] = [Prisma.sql`m."deletedAt" IS NULL`];
        if (q) {
            const n = `%${q.replace(/[\\%_]/g, "\\$&")}%`;
            const hit = (c: string) =>
                Prisma.sql`EXISTS (SELECT 1 FROM jsonb_each_text(${Prisma.raw(`CASE WHEN jsonb_typeof(${c}) = 'object' THEN ${c} ELSE '{}'::jsonb END`)}) t WHERE t.value ILIKE ${n})`;
            w.push(
                Prisma.sql`(${hit('m."title"')} OR ${hit('m."alt"')} OR m."originalName" ILIKE ${n})`,
            );
        }
        if (f.usedIn) w.push(this.usage.usedSql([f.usedIn]));
        if (f.unused === true) w.push(Prisma.sql`NOT ${this.usage.usedSql()}`);
        else if (f.unused === false && !f.usedIn) w.push(this.usage.usedSql());
        const rows = await this.prisma.$queryRaw<{ id: bigint }[]>`
            SELECT m.id FROM "MediaFile" m WHERE ${Prisma.join(w, " AND ")} LIMIT 5000`;
        return rows.map((r) => r.id);
    }
    /** Shared by list + summary. null = filters can match nothing. */
    private async buildWhere(
        user: AuthUser,
        f: MediaFilterInput,
    ): Promise<Prisma.MediaFileWhereInput | null> {
        const isAdmin = ADMINS.includes(user.role);
        if (
            f.uploadedById !== undefined &&
            !isAdmin &&
            f.uploadedById !== user.id
        )
            throw new ForbiddenException(this.t("media.access.forbidden"));
        const ids = await this.matchingIds(f);
        if (ids && !ids.length) return null;
        const and: Prisma.MediaFileWhereInput[] = [];
        // Non-admins: their own uploads; store managers also every supplier invoice of their store.
        // Support / KYC / delivery-proof evidence lives in its panel, not the library — admins see it only when filtering by that purpose.
        const storeInvoices: Prisma.MediaFileWhereInput | null =
            user.role === UserRole.STORE_MANAGER && user.storeId
                ? { purpose: MediaPurpose.INVOICE, uploadedBy: { storeId: user.storeId } }
                : null;
        if (!isAdmin)
            and.push({
                OR: [
                    { uploadedById: user.id, purpose: { notIn: EVIDENCE_PURPOSES } },
                    ...(storeInvoices ? [storeInvoices] : []),
                ],
            });
        else if (!f.purpose || !LIBRARY_HIDDEN_PURPOSES.includes(f.purpose))
            and.push({ purpose: { notIn: LIBRARY_HIDDEN_PURPOSES } });
        // Private files are hidden unless asked for (`includePrivate`, or filtering by the private purpose INVOICE).
        // They never get a public URL either way: only `GET /account/media/{id}/file` with these same checks.
        if (!f.includePrivate && f.purpose !== MediaPurpose.INVOICE) and.push({ isPrivate: false });
        if (f.visibility) and.push({ isPrivate: f.visibility === "PRIVATE" });
        return {
            deletedAt: null,
            ...(f.purpose ? { purpose: f.purpose } : {}),
            ...(f.status ? { status: f.status } : {}),
            ...(f.type ? { type: f.type } : {}),
            ...(f.uploadedById !== undefined
                ? { uploadedById: f.uploadedById }
                : {}),
            ...(ids ? { id: { in: ids } } : {}),
            ...(and.length ? { AND: and } : {}),
        };
    }
    async list(user: AuthUser, query: MediaListQueryInput) {
        const limit = Math.min(Math.max(Number(query.limit ?? 20), 1), 100);
        const page = Math.max(Number(query.page ?? 1), 1);
        const where = await this.buildWhere(user, query);
        if (!where)
            return { items: [], total: 0, page, limit, nextCursor: null };
        const cursor = cursorDecode(query.cursor);
        const keyset =
            !query.sort || query.sort === "newest" || query.sort === "oldest";
        const desc = !query.sort || query.sort === "newest";
        const op = desc ? "lt" : "gt";
        const pageWhere: Prisma.MediaFileWhereInput =
            cursor && keyset
                ? {
                      AND: [
                          where,
                          {
                              OR: [
                                  { createdAt: { [op]: cursor.createdAt } },
                                  {
                                      createdAt: cursor.createdAt,
                                      id: { [op]: cursor.id },
                                  },
                              ],
                          },
                      ],
                  }
                : where;
        const orderBy: Prisma.MediaFileOrderByWithRelationInput[] =
            query.sort === "oldest"
                ? [{ createdAt: "asc" }, { id: "asc" }]
                : query.sort === "size_desc"
                  ? [{ sizeBytes: "desc" }, { id: "desc" }]
                  : [{ createdAt: "desc" }, { id: "desc" }];
        const [rows, total] = await Promise.all([
            this.prisma.mediaFile.findMany({
                where: pageWhere,
                orderBy,
                skip: cursor ? 0 : (page - 1) * limit,
                take: limit + 1,
                include: { uploadedBy: { select: { id: true, name: true } } },
            }),
            this.prisma.mediaFile.count({ where }),
        ]);
        const items = rows.slice(0, limit);
        const last = items.at(-1);
        return {
            items: items.map((m) => ({
                ...this.present(m),
                canEdit: this.canModify(m, user),
                user: m.uploadedBy
                    ? {
                          id: m.uploadedBy.id.toString(),
                          name: m.uploadedBy.name,
                      }
                    : null,
            })),
            total,
            page,
            limit,
            nextCursor:
                rows.length > limit && last && keyset
                    ? cursorEncode({
                          id: last.id.toString(),
                          createdAt: last.createdAt.toISOString(),
                      })
                    : null,
        };
    }
    /** Group-by counts + bytes (purpose | type | status | uploader) under the same filters as list(). */
    async summary(user: AuthUser, query: MediaSummaryQueryInput) {
        const groupBy = query.groupBy ?? "purpose";
        const where = await this.buildWhere(user, query);
        if (!where) return { groupBy, groups: [], total: 0, totalBytes: 0 };
        const field = (
            {
                purpose: "purpose",
                type: "type",
                status: "status",
                uploader: "uploadedById",
            } as const
        )[groupBy];
        type G = Record<string, unknown> & {
            _count: { _all: number };
            _sum: { sizeBytes: number | null };
        };
        const rows = (await this.prisma.mediaFile.groupBy({
            by: [field] as ["purpose"],
            where,
            _count: { _all: true },
            _sum: { sizeBytes: true },
        })) as unknown as G[];
        const names = new Map<string, string | null>();
        if (groupBy === "uploader") {
            const users = await this.prisma.user.findMany({
                where: { id: { in: rows.map((r) => r[field] as bigint) } },
                select: { id: true, name: true },
            });
            users.forEach((u) => names.set(u.id.toString(), u.name));
        }
        const groups = rows
            .map((r) => ({
                key: String(r[field]),
                ...(groupBy === "uploader"
                    ? { label: names.get(String(r[field])) ?? null }
                    : {}),
                count: r._count._all,
                bytes: r._sum.sizeBytes ?? 0,
            }))
            .sort((x, y) => y.count - x.count);
        return {
            groupBy,
            groups,
            total: groups.reduce((n, g) => n + g.count, 0),
            totalBytes: groups.reduce((n, g) => n + g.bytes, 0),
        };
    }
    /* ───────────────────────── UPDATE ───────────────────────── */
    /** Edit title / alt: admins any file, others only their own uploads. */
    async patch(id: bigint, data: { title: Texts; alt?: Texts }, user: AuthUser) {
        this.assertCanModify(await this.mustFind(id), user);
        const next = this.cleanTexts(data.title, data.alt);
        const row = await this.prisma.mediaFile.update({
            where: { id },
            data: {
                ...(data.title !== undefined
                    ? { title: next.title ?? Prisma.JsonNull }
                    : {}),
                ...(data.alt !== undefined
                    ? { alt: next.alt ?? Prisma.JsonNull }
                    : {}),
            },
        });
        return this.present(row);
    }
    /** Replace bytes while keeping the id (so every reference stays valid). Done synchronously so the row stays READY. */
    async replaceFile(id: bigint, file: UploadedFile, user: AuthUser) {
        const old = await this.mustFind(id);
        this.assertCanModify(old, user);
        if (DEDICATED_UPLOAD_PURPOSES.includes(old.purpose))
            throw this.bad("media.avatar.useProfile");
        if (old.status !== MediaStatus.READY)
            throw new ConflictException(this.t("media.notReady"));
        if (!MEDIA_PURPOSE_ROLES[old.purpose].includes(user.role))
            throw new ForbiddenException(this.t("media.upload.forbidden"));
        if (!file?.buffer?.length) throw this.bad("media.file.required");
        const mime = sniff(file.buffer);
        const info = mime ? MIME_INFO[mime] : undefined;
        if (!mime || !info) throw this.bad("media.file.unsupported");
        const kind = TYPE_TO_KIND[old.type];
        if (info.kind !== kind) throw this.bad("media.replace.typeMismatch");
        this.assertKindAllowed(kind, old.purpose, user.role);
        this.assertSize(kind, file.buffer.length);
        const profile = kind === "image" ? this.profileOf(old.purpose) : null;
        const written: string[] = [];
        const put = async (key: string, buf: Buffer, m: string) => {
            await this.io(() => this.driver.put(key, buf, m, old.isPrivate));
            written.push(key);
        };
        try {
            let patch: Prisma.MediaFileUpdateInput;
            if (kind === "image") {
                const dims = await inspectImage(file.buffer, profile);
                if (profile) {
                    const { master, thumb } = await renderVariants(
                        file.buffer,
                        profile,
                    );
                    const masterKey = buildKey(
                        old.purpose,
                        kind,
                        user.id,
                        "webp",
                        "master",
                    );
                    const thumbKey = buildKey(
                        old.purpose,
                        kind,
                        user.id,
                        "webp",
                        "thumb",
                    );
                    await put(masterKey, master.data, "image/webp");
                    await put(thumbKey, thumb.data, "image/webp");
                    patch = {
                        key: masterKey,
                        mimeType: "image/webp",
                        sizeBytes: master.data.length,
                        width: master.width,
                        height: master.height,
                        variants: { master: masterKey, thumb: thumbKey },
                    };
                } else {
                    const key = buildKey(old.purpose, kind, user.id, info.ext);
                    await put(key, file.buffer, mime);
                    patch = {
                        key,
                        mimeType: mime,
                        sizeBytes: file.buffer.length,
                        width: dims.width,
                        height: dims.height,
                        variants: { master: key },
                    };
                }
            } else {
                const key = buildKey(old.purpose, kind, user.id, info.ext);
                await put(key, file.buffer, mime);
                patch = {
                    key,
                    mimeType: mime,
                    sizeBytes: file.buffer.length,
                    variants: { master: key },
                };
            }
            const originalName = safeFileName(file.originalname, info.ext);
            const row = await this.prisma.mediaFile.update({
                where: { id },
                data: { ...patch, originalName, checksum: sha256(file.buffer) },
            });
            // Old objects: keep them if an order-history snapshot (OrderItem.imageKey) still points at them.
            const oldKeys = collectKeys(old);
            if (!(await this.usage.snapshotRefs(oldKeys)).length) {
                await this.purgeObjects(old).catch((e) =>
                    this.log.warn(`old objects of ${id} not removed: ${e}`),
                );
            }
            return this.present(row);
        } catch (e) {
            await Promise.all(
                written.map((k) =>
                    this.driver.remove(k, old.isPrivate).catch(() => undefined),
                ),
            );
            if (e instanceof MediaRuleError) throw this.fromRule(e);
            throw e;
        }
    }
    /**
     * Uploads a new avatar and makes it the user's ONLY avatar right away
     * (PUT /account/avatar). Avatars never go through the library, so nobody can
     * pick another user's image. Processing to 512×512 continues in the
     * background; until it is READY the profile shows `status: PROCESSING`.
     */
    async uploadUserAvatar(file: UploadedFile, user: AuthUser) {
        const title = { [this.locale.defaultLanguage]: "Avatar" };
        const media = await this.upload(file, { purpose: MediaPurpose.AVATAR, title }, user, { dedicated: true });

        return this.applyUserAvatar(user.id, BigInt(media.id));
    }

    /** Points User.avatarId at `avatarId` and retires every other avatar of that user. */
    private async applyUserAvatar(userId: bigint, avatarId: bigint) {
        return this.prisma.$transaction(async (tx) => {
            // Serialize avatar changes for this user.
            const locked = await tx.$queryRaw<{ avatarId: bigint | null }[]>`
                SELECT "avatarId" FROM "User"
                WHERE id = ${userId} AND "deletedAt" IS NULL
                FOR UPDATE`;

            if (!locked.length) throw new NotFoundException(this.t("media.notFound"));

            const avatar = await tx.mediaFile.findFirst({
                where: {
                    id: avatarId,
                    purpose: MediaPurpose.AVATAR,
                    type: MediaType.IMAGE,
                    status: { in: [MediaStatus.PROCESSING, MediaStatus.READY] },
                    deletedAt: null,
                    uploadedById: userId,
                },
                select: { id: true },
            });

            if (!avatar) throw this.bad("media.avatar.invalid");

            await tx.user.update({ where: { id: userId }, data: { avatarId: avatar.id } });
            const retired = await this.retireAvatars(tx, userId, avatar.id);

            return {
                success: true,
                avatarId: avatar.id.toString(),
                previousAvatarId: locked[0].avatarId && locked[0].avatarId !== avatar.id ? locked[0].avatarId.toString() : null,
                retired,
            };
        });
    }

    /** Clears User.avatarId and retires all of the user's avatars. */
    async removeUserAvatar(userId: bigint) {
        return this.prisma.$transaction(async (tx) => {
            const locked = await tx.$queryRaw<{ avatarId: bigint | null }[]>`
                SELECT "avatarId" FROM "User"
                WHERE id = ${userId} AND "deletedAt" IS NULL
                FOR UPDATE`;

            if (!locked.length) throw new NotFoundException(this.t("media.notFound"));

            await tx.user.update({ where: { id: userId }, data: { avatarId: null } });
            const retired = await this.retireAvatars(tx, userId, null);

            return { success: true, previousAvatarId: locked[0].avatarId?.toString() ?? null, retired };
        });
    }

    /**
     * Soft-deletes the user's avatars except `keepId` (one avatar per user).
     * MediaCleanupService removes the stored objects later.
     */
    private async retireAvatars(tx: Prisma.TransactionClient, userId: bigint, keepId: bigint | null) {
        const stale = await tx.mediaFile.findMany({
            where: {
                uploadedById: userId,
                purpose: MediaPurpose.AVATAR,
                deletedAt: null,
                ...(keepId ? { id: { not: keepId } } : {}),
            },
            select: { id: true },
        });

        let count = 0;

        for (const { id } of stale) {
            // Never delete a file something else still references.
            if ((await this.usage.detail(id, tx)).total > 0) continue;
            await tx.mediaFile.update({ where: { id }, data: { deletedAt: new Date() } });
            count++;
        }

        return count;
    }

    async retry(id: bigint, user: AuthUser) {
        const m = await this.mustFind(id);
        this.assertOwnerOrAdmin(m, user);
        if (
            m.status !== MediaStatus.FAILED ||
            m.type !== MediaType.IMAGE ||
            !this.profileOf(m.purpose)
        )
            throw new ConflictException(this.t("media.retry.notAllowed"));
        await this.prisma.mediaFile.update({
            where: { id },
            data: {
                status: MediaStatus.PROCESSING,
                attempts: 0,
                lockedAt: null,
                failureReason: null,
            },
        });
        this.processor.kick();
        return this.status(id, user);
    }
    /* ───────────────────────── USAGE / DELETE ───────────────────────── */
    async usageOf(id: bigint, user: AuthUser) {
        await this.assertCanViewInLibrary(await this.mustFind(id), user);
        return this.usage.detail(id);
    }
    /**
     * Refuses to delete media that is used anywhere. No `force`.
     * Soft-deletes; MediaCleanupService then removes the storage objects and the row.
     * The row is locked FOR UPDATE; FK inserts that reference it take FOR KEY SHARE,
     * which blocks until we commit, so "check then delete" cannot race.
     */
    /**
     * Delete: admins any file, others only their own uploads; refused while in use.
     * `user` is omitted only by system jobs (MediaCleanupService orphan sweep).
     */
    async remove(id: bigint, user?: AuthUser) {
        if (user) this.assertCanModify(await this.mustFind(id), user);
        await this.prisma.$transaction(async (tx) => {
            const locked = await tx.$queryRaw<{ id: bigint }[]>`
                SELECT id FROM "MediaFile" WHERE id = ${id} AND "deletedAt" IS NULL FOR UPDATE`;
            if (!locked.length)
                throw new NotFoundException(this.t("media.notFound"));
            const usage = await this.usage.detail(id, tx);
            if (usage.total > 0)
                throw new ConflictException({
                    message: this.t("media.inUse"),
                    code: "MEDIA_IN_USE",
                    usage,
                });
            await tx.mediaFile.update({
                where: { id },
                data: { deletedAt: new Date() },
            });
        });
        return { success: true, id: id.toString() };
    }
    /**
     * Deletes media an entity just stopped pointing at (a removed or replaced icon / logo / banner).
     * Best effort and only when nothing else uses the file: `remove` re-checks usage under a row lock,
     * so a file shared with another category / brand / screen stays (MEDIA_IN_USE is ignored).
     * Call it AFTER the entity's transaction committed, with the ids it dropped.
     */
    async removeDetached(ids: (bigint | null | undefined)[]) {
        const unique = [...new Set(ids.filter((id): id is bigint => id != null).map(String))];
        for (const id of unique) {
            try {
                await this.remove(BigInt(id));
            } catch (e) {
                if (e instanceof ConflictException || e instanceof NotFoundException) continue;
                this.log.warn(`could not remove detached media ${id}: ${e}`);
            }
        }
    }
    /* ───────────────────────── SERVE ───────────────────────── */
    async serve(
        id: bigint,
        user: AuthUser,
        variant: MediaVariant,
        req: { range?: string; ifNoneMatch?: string },
    ): Promise<{
        status: number;
        headers: Record<string, string | number>;
        redirect?: string;
        stream?: Readable;
    }> {
        const m = await this.mustFind(id);
        if (m.status !== MediaStatus.READY)
            throw new ConflictException(this.t("media.notReady"));

        // Avatars: only the owner and admins may fetch them by id.
        if (
            DEDICATED_UPLOAD_PURPOSES.includes(m.purpose) &&
            m.uploadedById !== user?.id &&
            !(user && ADMINS.includes(user.role))
        ) {
            throw new ForbiddenException(this.t("media.access.forbidden"));
        }

        const variants = (m.variants as Record<string, string> | null) ?? {};
        const key =
            (variant === "thumb" ? variants.thumb : variants.master) ??
            variants.master ??
            m.key;

        // Redirect remote public files to their CDN. Local storage is not
        // exposed at /static, so stream local files through this API endpoint.
        if (!m.isPrivate && m.provider !== "LOCAL") {
            return {
                status: 302,
                redirect: this.driver.url(key),
                headers: { "Cache-Control": "public, max-age=300" },
            };
        }

        if (m.isPrivate) {
            if (!user) throw new ForbiddenException(this.t("media.access.forbidden"));
            await this.assertCanReadPrivate(m, user);
        }

        const etag = `"${createHash("md5").update(key).digest("hex")}"`;
        const cache = m.isPrivate
            ? "private, max-age=60, must-revalidate"
            : "public, max-age=300";

        if (req.ifNoneMatch === etag) {
            return {
                status: 304,
                headers: { ETag: etag, "Cache-Control": cache },
            };
        }

        const { size } = await this.io(() =>
            this.driver.head(key, m.isPrivate),
        );
        let start = 0;
        let end = size - 1;
        let status = 200;
        const range = req.range ? /^bytes=(\d*)-(\d*)$/.exec(req.range) : null;

        if (range && (range[1] || range[2])) {
            if (range[1] === "") start = Math.max(size - Number(range[2]), 0);
            else {
                start = Number(range[1]);
                if (range[2]) end = Math.min(Number(range[2]), size - 1);
            }

            if (start > end || start >= size) {
                return {
                    status: 416,
                    headers: {
                        "Content-Range": `bytes */${size}`,
                        "Accept-Ranges": "bytes",
                    },
                };
            }
            status = 206;
        }

        const stream = await this.io(() =>
            this.driver.createReadStream(
                key,
                m.isPrivate,
                status === 206 ? { start, end } : undefined,
            ),
        );
        const headers: Record<string, string | number> = {
            "Content-Type": m.mimeType,
            "Content-Length": end - start + 1,
            "Accept-Ranges": "bytes",
            ETag: etag,
            "Cache-Control": cache,
            "X-Content-Type-Options": "nosniff",
            "Content-Security-Policy": "default-src 'none'; sandbox",
        };

        if (status === 206)
            headers["Content-Range"] = `bytes ${start}-${end}/${size}`;
        if (m.type !== MediaType.IMAGE && m.originalName) {
            headers["Content-Disposition"] =
                `inline; filename*=UTF-8''${encodeURIComponent(m.originalName)}`;
        }

        return { status, headers, stream };
    }
}
