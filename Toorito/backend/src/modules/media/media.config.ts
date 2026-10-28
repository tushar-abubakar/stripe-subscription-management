import { AppConfig } from "@config/config.type";
import { ImageProfileConfig } from "@config/mediaProfile.const";
import type { ConfigService } from "@nestjs/config";
import { MediaPurpose, MediaType, UserRole } from "@prisma-client/enums";

export type MediaKind = "image" | "video" | "audio" | "document";

/* ───────────── file types ───────────── */
export const MIME_INFO: Record<string, { ext: string; kind: MediaKind }> = {
    "image/jpeg": { ext: "jpg", kind: "image" },
    "image/png": { ext: "png", kind: "image" },
    "image/webp": { ext: "webp", kind: "image" },
    "application/pdf": { ext: "pdf", kind: "document" },
    "video/mp4": { ext: "mp4", kind: "video" },
    "audio/mpeg": { ext: "mp3", kind: "audio" },
    "audio/aac": { ext: "aac", kind: "audio" },
    "audio/mp4": { ext: "m4a", kind: "audio" },
    "audio/wav": { ext: "wav", kind: "audio" },
    "audio/ogg": { ext: "ogg", kind: "audio" },
    "audio/flac": { ext: "flac", kind: "audio" },
};

const MIME_ALIASES: Record<string, string> = {
    "image/jpg": "image/jpeg",
    "audio/mp3": "audio/mpeg",
    "audio/x-mp3": "audio/mpeg",
    "audio/x-aac": "audio/aac",
    "audio/aacp": "audio/aac",
    "audio/x-m4a": "audio/mp4",
    "audio/m4a": "audio/mp4",
    "audio/x-wav": "audio/wav",
    "audio/wave": "audio/wav",
    "audio/vnd.wave": "audio/wav",
    "audio/x-flac": "audio/flac",
    "application/ogg": "audio/ogg",
};

export const canonicalMime = (m: string) => {
    const l = m.toLowerCase().split(";")[0]!.trim();
    return MIME_ALIASES[l] ?? l;
};

export const KIND_TO_TYPE: Record<MediaKind, MediaType> = {
    image: MediaType.IMAGE,
    video: MediaType.VIDEO,
    audio: MediaType.AUDIO,
    document: MediaType.DOCUMENT,
};
export const TYPE_TO_KIND: Record<MediaType, MediaKind> = {
    [MediaType.IMAGE]: "image",
    [MediaType.VIDEO]: "video",
    [MediaType.AUDIO]: "audio",
    [MediaType.DOCUMENT]: "document",
};

/* ───────────── purpose policy (backend allowlist; frontend never picks dimensions/keys) ───────────── */
export const ADMINS: UserRole[] = [UserRole.ADMIN, UserRole.SUPER_ADMIN];
export const VIDEO_ROLES: UserRole[] = ADMINS;
export const PRIVATE_PURPOSES: MediaPurpose[] = [
    MediaPurpose.KYC,
    MediaPurpose.DELIVERY_PROOF,
    MediaPurpose.SUPPORT,
    MediaPurpose.INVOICE,
];

/**
 * Evidence files: forensic metadata (EXIF / editing / AI markers / reuse) is
 * captured from the original bytes on upload. All are private (no public
 * URL; served only by the authorised `GET /account/media/{id}/file`).
 */
export const EVIDENCE_PURPOSES: MediaPurpose[] = [
    MediaPurpose.SUPPORT,
    MediaPurpose.KYC,
    MediaPurpose.INVOICE,
    MediaPurpose.DELIVERY_PROOF,
];
/**
 * Evidence that never appears in a media library — only in its own panel
 * (support / returns, KYC, deliveries). Admins see it in the library only
 * when filtering by that purpose. INVOICE is the exception: store managers
 * see their store's supplier invoices in the library, admins see all.
 */
export const LIBRARY_HIDDEN_PURPOSES: MediaPurpose[] = [
    MediaPurpose.SUPPORT,
    MediaPurpose.KYC,
    MediaPurpose.DELIVERY_PROOF,
];
export const USER_SCOPED_PURPOSES: MediaPurpose[] = [
    MediaPurpose.AVATAR,
    MediaPurpose.KYC,
    MediaPurpose.DELIVERY_PROOF,
    MediaPurpose.SUPPORT,
    MediaPurpose.INVOICE,
];
export const PRIVATE_READERS: UserRole[] = [...ADMINS, UserRole.STORE_MANAGER];
/**
 * Who may read private files per purpose. Store roles are further limited to
 * files of their own store (MediaService.assertCanReadPrivate). KYC: admins and
 * the person the document belongs to — not the store manager who uploaded it.
 */
export const PRIVATE_READERS_BY_PURPOSE: Partial<
    Record<MediaPurpose, UserRole[]>
> = {
    [MediaPurpose.KYC]: ADMINS,
    [MediaPurpose.DELIVERY_PROOF]: PRIVATE_READERS,
    [MediaPurpose.SUPPORT]: [...PRIVATE_READERS, UserRole.STORE_STAFF],
    // Staff can open only invoices they uploaded themselves.
    [MediaPurpose.INVOICE]: PRIVATE_READERS,
};

/** Library filters: "used in" resource types and summary groupings. */
export const MEDIA_USAGE_TYPES = [
    "product",
    "category",
    "brand",
    "store",
    "bundle",
    "user",
    "kyc",
    "delivery",
    "optionValue",
    "support",
    "orderItem",
    "goodsReceipt",
    "approval",
    "sdui",
] as const;
export type MediaUsageType = (typeof MEDIA_USAGE_TYPES)[number];
export const MEDIA_GROUP_BY = [
    "purpose",
    "type",
    "status",
    "uploader",
] as const;
export type MediaGroupBy = (typeof MEDIA_GROUP_BY)[number];

/**
 * Catalog media: shown to store managers in the library (view + details),
 * whoever uploaded it. Everything else is visible to admins and its uploader only.
 */
export const CATALOG_PURPOSES: MediaPurpose[] = [
    MediaPurpose.PRODUCT,
    MediaPurpose.CATEGORY,
    MediaPurpose.CATEGORY_BANNER,
    MediaPurpose.BRAND,
    MediaPurpose.BRAND_BANNER,
    MediaPurpose.OPTIONVALUE,
    MediaPurpose.BUNDLE,
    MediaPurpose.STORE,
];

/** Roles that browse the library; non-admins see ONLY their own uploads (never evidence files). */
export const LIBRARY_ROLES: UserRole[] = [...ADMINS, UserRole.STORE_MANAGER];

/** Avatars are uploaded only through PUT /account/avatar (one per user), never through the library. */
export const DEDICATED_UPLOAD_PURPOSES: MediaPurpose[] = [MediaPurpose.AVATAR];

export const MEDIA_PURPOSE_ROLES: Record<MediaPurpose, UserRole[]> = {
    // Store managers may add product / variant photos (images only, see MediaService.assertKindAllowed).
    [MediaPurpose.PRODUCT]: [...ADMINS, UserRole.STORE_MANAGER],
    [MediaPurpose.CATEGORY]: ADMINS,
    [MediaPurpose.CATEGORY_BANNER]: ADMINS,
    [MediaPurpose.BRAND]: ADMINS,
    [MediaPurpose.BRAND_BANNER]: ADMINS,
    [MediaPurpose.OPTIONVALUE]: ADMINS,
    [MediaPurpose.STORE]: [...ADMINS, UserRole.STORE_MANAGER],
    [MediaPurpose.BUNDLE]: [...ADMINS, UserRole.STORE_MANAGER],
    [MediaPurpose.OTHER]: ADMINS,
    [MediaPurpose.AVATAR]: [
        UserRole.CUSTOMER,
        UserRole.ADMIN,
        UserRole.SUPER_ADMIN,
        UserRole.STORE_MANAGER,
        UserRole.STORE_STAFF,
        UserRole.DELIVERY_PARTNER,
    ],
    // Store managers upload KYC while onboarding staff / delivery partners (they can't open them afterwards).
    [MediaPurpose.KYC]: [
        UserRole.DELIVERY_PARTNER,
        UserRole.STORE_STAFF,
        UserRole.STORE_MANAGER,
    ],
    [MediaPurpose.INVOICE]: [
        ...ADMINS,
        UserRole.STORE_MANAGER,
        UserRole.STORE_STAFF,
    ],
    [MediaPurpose.DELIVERY_PROOF]: [UserRole.DELIVERY_PARTNER],
    [MediaPurpose.SUPPORT]: [
        UserRole.CUSTOMER,
        UserRole.DELIVERY_PARTNER,
        UserRole.STORE_MANAGER,
        UserRole.STORE_STAFF,
    ],
    [MediaPurpose.BANNER]: ADMINS,
};

/** Which file kinds each purpose accepts. Video is additionally limited to VIDEO_ROLES. */
export const PURPOSE_KINDS: Record<MediaPurpose, MediaKind[]> = {
    [MediaPurpose.PRODUCT]: ["image", "video", "audio"],
    [MediaPurpose.CATEGORY]: ["image"],
    [MediaPurpose.CATEGORY_BANNER]: ["image"],
    [MediaPurpose.BRAND]: ["image"],
    [MediaPurpose.BRAND_BANNER]: ["image"],
    [MediaPurpose.OPTIONVALUE]: ["image"],
    [MediaPurpose.STORE]: ["image"],
    [MediaPurpose.BUNDLE]: ["image"],
    [MediaPurpose.AVATAR]: ["image"],
    [MediaPurpose.KYC]: ["image", "document"],
    [MediaPurpose.DELIVERY_PROOF]: ["image"],
    [MediaPurpose.SUPPORT]: ["image", "document", "audio"],
    [MediaPurpose.INVOICE]: ["image", "document"],
    [MediaPurpose.OTHER]: ["image", "video", "audio"],
    [MediaPurpose.BANNER]: ["image"],
};

/* ───────────── image profile per purpose (built from AppConfig.media.image.profiles) ───────────── */
type Profiles = AppConfig["media"]["purposes"];

export type ProfileMap = Partial<Record<MediaPurpose, ImageProfileConfig>>;

export function buildProfileMap(p: Profiles): ProfileMap {
    return {
        [MediaPurpose.PRODUCT]: p.PRODUCT.image?.profiles.image,
        [MediaPurpose.CATEGORY]: p.CATEGORY.image?.profiles.icon,
        [MediaPurpose.CATEGORY_BANNER]: p.CATEGORY.image?.profiles.banner,
        [MediaPurpose.BRAND]: p.BRAND.image?.profiles.logo,
        [MediaPurpose.BRAND_BANNER]: p.BRAND.image?.profiles.banner,
        [MediaPurpose.OPTIONVALUE]: p.OPTIONVALUE.image?.profiles.image,
        [MediaPurpose.STORE]: p.STORE.image?.profiles.logo,
        [MediaPurpose.BUNDLE]: p.BUNDLE.image?.profiles.image,
        [MediaPurpose.AVATAR]: p.AVATAR.image?.profiles.image,
        [MediaPurpose.DELIVERY_PROOF]: p.DELIVERY_PROOF.image?.profiles.image,
        [MediaPurpose.SUPPORT]: p.SUPPORT.image?.profiles.image,
        [MediaPurpose.OTHER]: p.OTHER.image?.profiles.image,

        // KYC deliberately has no image profile.
        // Preserve its original uploaded bytes.
    };
}

/** cover/contain profiles require the source to be at least master size; "inside" never upscales. */
export const minDimensions = (p: ImageProfileConfig | null) =>
    p && p.master.fit !== "inside"
        ? { width: p.master.width, height: p.master.height }
        : null;

/** Multer ceiling = largest configured per-type limit; MediaService enforces the exact per-type limit. */
export function resolveMaxUploadBytes(config: ConfigService): number {
    const m = config.getOrThrow<AppConfig["media"]>("media");
    return Math.max(
        m.image.maxBytes,
        m.video.maxBytes,
        m.audio.maxBytes,
        m.document.maxBytes,
    );
}
