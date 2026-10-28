import { MIME_INFO } from "@modules/media/media.config";
import { InitUploadDto, UpdateMediaDto } from "./media.dto";
import { applyDecorators } from "@nestjs/common";
import {
    ApiBadRequestResponse,
    ApiBody,
    ApiConflictResponse,
    ApiConsumes,
    ApiCreatedResponse,
    ApiForbiddenResponse,
    ApiHeader,
    ApiNotFoundResponse,
    ApiOkResponse,
    ApiOperation,
    ApiParam,
    ApiPayloadTooLargeResponse,
    ApiProduces,
    ApiQuery,
    ApiResponse,
    ApiUnauthorizedResponse,
    type ApiResponseOptions,
} from "@nestjs/swagger";
import { MediaPurpose } from "@prisma-client/enums";

/* One swagger decorator per endpoint (Media<Name>Docs), shared schemas first. */

type Code = 400 | 401 | 403 | 404 | 409 | 413;
type Dec = (o: ApiResponseOptions) => MethodDecorator & ClassDecorator;

const body = (
    statusCode: number,
    error: string,
    message: string,
    extra: object = {},
) => ({
    type: "object",
    properties: {
        statusCode: { type: "number", example: statusCode },
        message: { type: "string", example: message },
        error: { type: "string", example: error },
        ...extra,
    },
});
const ERR: Record<Code, [Dec, string, string, string]> = {
    400: [
        ApiBadRequestResponse,
        "Bad Request",
        "Image is smaller than 1000x1000",
        "Validation, file signature/kind, size or minimum-dimension rule failed",
    ],
    401: [
        ApiUnauthorizedResponse,
        "Unauthorized",
        "Unauthorized",
        "Missing or invalid bearer token",
    ],
    403: [
        ApiForbiddenResponse,
        "Forbidden",
        "You cannot access this media",
        "Role, permission, ownership or privacy rule denied access",
    ],
    404: [
        ApiNotFoundResponse,
        "Not Found",
        "Media not found",
        "Media does not exist or was deleted",
    ],
    409: [
        ApiConflictResponse,
        "Conflict",
        "Media is not ready",
        "State conflict",
    ],
    413: [
        ApiPayloadTooLargeResponse,
        "Payload Too Large",
        "File is larger than 10 MB",
        "File exceeds the limit for its type (image/video/audio/document)",
    ],
};
export const errors = (...codes: Code[]) =>
    codes.map((c) =>
        ERR[c][0]({
            description: ERR[c][3],
            schema: body(c, ERR[c][1], ERR[c][2]),
        }),
    );
export const conflict = (
    description: string,
    message: string,
    extra: object = {},
) =>
    ApiConflictResponse({
        description,
        schema: body(409, "Conflict", message, extra),
    });

const ACCEPT_LANGUAGE = {
    name: "Accept-Language",
    required: false,
    description: "Language of error messages",
    schema: { type: "string", example: "en" },
};
/** Operation + Accept-Language header + 401 + the given error codes. */
export const op = (
    summary: string,
    description: string,
    ...codes: Exclude<Code, 401>[]
) =>
    applyDecorators(
        ApiOperation({ summary, description }),
        ApiHeader(ACCEPT_LANGUAGE),
        ...errors(401, ...codes),
    );

export const idParam = () =>
    ApiParam({
        name: "id",
        type: String,
        example: "123",
        description: "Media ID (bigint as string)",
    });
export const purposeEnum = {
    type: "string",
    enum: Object.values(MediaPurpose),
    example: "PRODUCT",
};
export const localized = (example: object) => ({
    type: "object",
    additionalProperties: { type: "string" },
    example,
});
export const file = { type: "string", format: "binary" };

export const rules = {
    type: "object",
    description: "Client-side pre-validation rules",
    properties: {
        maxBytes: { type: "integer", example: 10485760 },
        image: {
            type: "object",
            nullable: true,
            description:
                "Larger images are auto-cropped/resized to target; smaller than min is rejected",
            properties: {
                fit: { type: "string", enum: ["contain", "cover", "inside"] },
                targetWidth: { type: "integer", example: 1000 },
                targetHeight: { type: "integer", example: 1000 },
                minWidth: { type: "integer", nullable: true, example: 1000 },
                minHeight: { type: "integer", nullable: true, example: 1000 },
                thumbnail: {
                    type: "object",
                    properties: {
                        width: { type: "integer", example: 512 },
                        height: { type: "integer", example: 512 },
                    },
                },
            },
        },
    },
};
export const progress = {
    type: "object",
    description:
        "Server-side stage. Byte-level upload progress/ETA is measured by the client (XHR upload events).",
    properties: {
        stage: {
            type: "string",
            enum: ["awaiting_upload", "processing", "done", "failed"],
            example: "processing",
        },
        percent: { type: "integer", example: 80 },
        queuePosition: { type: "integer", nullable: true, example: 2 },
        etaSec: { type: "integer", nullable: true, example: 6 },
        pollAfterMs: {
            type: "integer",
            nullable: true,
            example: 1000,
            description:
                "Recommended delay before the next status poll; null = stop polling",
        },
    },
};
export const mediaItem = {
    type: "object",
    properties: {
        id: { type: "string", example: "123" },
        status: {
            type: "string",
            enum: ["PENDING", "PROCESSING", "READY", "FAILED"],
            example: "READY",
        },
        failureReason: { type: "string", nullable: true, example: null },
        title: {
            ...localized({ en: "Red apple", hi: "लाल सेब" }),
            nullable: true,
        },
        alt: {
            ...localized({ en: "Red apple on white background" }),
            nullable: true,
        },
        originalName: { type: "string", example: "apple.webp" },
        mimeType: { type: "string", example: "image/webp" },
        size: { type: "integer", example: 145000 },
        width: { type: "integer", nullable: true, example: 1000 },
        height: { type: "integer", nullable: true, example: 1000 },
        purpose: purposeEnum,
        uploadedById: { type: "string", example: "42" },
        type: {
            type: "string",
            enum: ["IMAGE", "VIDEO", "AUDIO", "DOCUMENT"],
            example: "IMAGE",
        },
        isPrivate: { type: "boolean", example: false },
        variants: {
            type: "object",
            nullable: true,
            properties: {
                thumb: {
                    type: "string",
                    nullable: true,
                    example:
                        "https://cdn.example.com/product/images/2026/10/x-thumb.webp",
                },
                master: {
                    type: "string",
                    nullable: true,
                    example:
                        "https://cdn.example.com/product/images/2026/10/x-master.webp",
                },
            },
        },
        url: {
            type: "string",
            nullable: true,
            description: "Public CDN URL; null for private media",
            example:
                "https://cdn.example.com/product/images/2026/10/x-master.webp",
        },
        accessUrl: {
            type: "string",
            nullable: true,
            description: "Authenticated URL for private media",
            example: null,
        },
        createdAt: {
            type: "string",
            format: "date-time",
            example: "2026-10-17T10:00:00.000Z",
        },
    },
};
export const withUser = {
    ...mediaItem,
    properties: {
        ...mediaItem.properties,
        user: {
            type: "object",
            nullable: true,
            properties: {
                id: { type: "string", example: "42" },
                name: { type: "string", example: "Asha" },
            },
        },
    },
};

/* ── init-upload ── */
export const MediaInitUploadDocs = () =>
    applyDecorators(
        op(
            "Step 1 – declare the file",
            "Validates purpose/role/kind/size and creates a PENDING row (uploadedById = caller). Returns a signed direct-upload target or a proxy URL. Store managers may upload PRODUCT images (no video/audio). AVATAR is rejected here — use PUT /account/avatar.",
            400,
            403,
        ),
        ApiBody({
            type: InitUploadDto,
            schema: {
                type: "object",
                required: ["purpose", "fileName", "mimeType", "size"],
                properties: {
                    purpose: purposeEnum,
                    fileName: {
                        type: "string",
                        maxLength: 255,
                        example: "apple.png",
                    },
                    mimeType: {
                        type: "string",
                        enum: Object.keys(MIME_INFO),
                        example: "image/png",
                    },
                    size: {
                        type: "integer",
                        minimum: 1,
                        example: 240000,
                        description: "Exact bytes",
                    },
                    title: localized({ en: "Red apple" }),
                    alt: localized({ en: "Fresh red apple" }),
                },
            },
        }),
        ApiCreatedResponse({
            description: "Upload initialised",
            schema: {
                type: "object",
                properties: {
                    id: { type: "string", example: "123" },
                    status: { type: "string", example: "PENDING" },
                    maxBytes: { type: "integer", example: 240000 },
                    upload: {
                        type: "object",
                        description:
                            "mode=proxy → PUT multipart to url; mode=direct → PUT bytes to the signed url",
                        example: {
                            mode: "proxy",
                            method: "PUT",
                            url: "/account/media/uploads/123/content",
                            field: "file",
                        },
                    },
                    rules,
                    completeUrl: {
                        type: "string",
                        example: "/account/media/uploads/123/complete",
                    },
                    statusUrl: { type: "string", example: "/account/media/123/status" },
                    expiresAt: { type: "string", format: "date-time" },
                },
            },
        }),
    );

/* ── upload-content ── */
export const MediaUploadContentDocs = () =>
    applyDecorators(
        op(
            "Step 1b – send bytes (proxy mode only)",
            "Only for drivers without signed uploads. Owner or admin. Size must not exceed the declared size. Measure upload progress client-side (XHR upload.onprogress).",
            400,
            403,
            404,
            413,
        ),
        idParam(),
        ApiConsumes("multipart/form-data"),
        ApiBody({
            schema: {
                type: "object",
                required: ["file"],
                properties: { file },
            },
        }),
        ApiOkResponse({
            description: "Bytes stored",
            schema: {
                type: "object",
                example: { id: "123", status: "PENDING" },
            },
        }),
        conflict("Upload already completed", "Upload already completed"),
    );

/* ── complete-upload ── */
export const MediaCompleteUploadDocs = () =>
    applyDecorators(
        op(
            "Step 2 – verify and queue processing",
            "Checks size, magic-bytes, min dimensions (images), de-duplicates public files per uploader, then marks READY (documents/audio/video/KYC) or PROCESSING (images to crop/resize). Invalid uploads are discarded and return 400. Idempotent.",
            400,
            403,
            404,
        ),
        idParam(),
        ApiOkResponse({
            description: "READY or PROCESSING",
            schema: mediaItem,
        }),
    );

/* ── status ── */
export const MediaStatusDocs = () =>
    applyDecorators(
        op(
            "Poll status, progress and ETA",
            "Owner or admin. Poll every `progress.pollAfterMs` until it is null.",
            403,
            404,
        ),
        idParam(),
        ApiOkResponse({
            description: "Media + attempts + progress",
            schema: {
                ...mediaItem,
                properties: {
                    ...mediaItem.properties,
                    attempts: { type: "integer", example: 1 },
                    progress,
                },
            },
        }),
    );

/* ── retry ── */
export const MediaRetryDocs = () =>
    applyDecorators(
        op(
            "Retry failed image processing",
            "Owner or admin. Only FAILED images that have a processing profile.",
            403,
            404,
        ),
        idParam(),
        ApiOkResponse({ description: "Re-queued", schema: mediaItem }),
        conflict("Not retryable", "Retry not allowed"),
    );

/* ── one-shot-upload ── */
export const MediaOneShotUploadDocs = () =>
    applyDecorators(
        op(
            "One-request multipart upload",
            "init + upload + complete in one call; same validation as the two-step flow. Poll /account/media/:id/status if the result is PROCESSING. Store managers may upload PRODUCT images (no video/audio). AVATAR is rejected here — use PUT /account/avatar.",
            400,
            403,
            413,
        ),
        ApiConsumes("multipart/form-data"),
        ApiBody({
            schema: {
                type: "object",
                required: ["file", "purpose"],
                properties: {
                    file,
                    purpose: purposeEnum,
                    title: {
                        type: "string",
                        example: '{"en":"Red apple","hi":"लाल सेब"}',
                        description: "JSON string",
                    },
                    alt: {
                        type: "string",
                        example: '{"en":"Red apple"}',
                        description: "JSON string",
                    },
                },
            },
        }),
        ApiCreatedResponse({
            description: "READY or PROCESSING",
            schema: mediaItem,
        }),
    );

/* ── purposes ── */
export const MediaPurposesDocs = () =>
    applyDecorators(
        op(
            "Allowed purposes + policy matrix",
            "`purposes`: what you may upload through the library (AVATAR is never listed — it has its own endpoint, PUT /account/avatar). `matrix`: per purpose roles, kinds, private flag, private readers, max bytes per kind, image min/target size.",
        ),
        ApiOkResponse({
            schema: {
                type: "object",
                example: {
                    purposes: ["SUPPORT"],
                    matrix: {
                        AVATAR: {
                            roles: ["CUSTOMER"],
                            kinds: ["image"],
                            isPrivate: false,
                            readers: null,
                            maxBytes: { image: 10485760 },
                            image: {
                                fit: "cover",
                                targetWidth: 512,
                                targetHeight: 512,
                                minWidth: 512,
                                minHeight: 512,
                                thumbnail: { width: 200, height: 200 },
                            },
                        },
                    },
                },
            },
        }),
    );

/* ── list ── */
export const MediaListDocs = () =>
    applyDecorators(
        op(
            "Media library: filter, search, paginate",
            "Admins see everything except support / KYC / delivery-proof evidence, which they see only when filtering by that `purpose`. " +
                "Store managers see their own uploads plus every supplier invoice (`purpose=INVOICE`) of their store — uploaded by the store's team or attached to its goods receipts. " +
                "Support, KYC and delivery-proof files never appear in a manager's library (they live in the support / KYC panels). Store staff have no library. " +
                "Each item has `canEdit` (true for your own uploads, or any file for admins). Filters: q (title/alt any language, file name), purpose, status, type, uploadedById, usedIn " +
                "(incl. `goodsReceipt`, `approval`), unused, visibility/includePrivate. Pagination: page+limit (max 100) or cursor (newest/oldest). " +
                "Private files (all invoices) are hidden by default — pass `includePrivate=true` or `purpose=INVOICE`. They never have a public `url`: only `accessUrl` " +
                "(`GET /account/media/{id}/file`, bearer token, same checks). Files in use (e.g. an invoice attached to a GRN) can't be deleted (`409 MEDIA_IN_USE`).",
            400,
            403,
        ),
        ApiOkResponse({
            schema: {
                type: "object",
                properties: {
                    items: { type: "array", items: withUser },
                    total: { type: "integer", example: 137 },
                    page: { type: "integer", example: 1 },
                    limit: { type: "integer", example: 20 },
                    nextCursor: {
                        type: "string",
                        nullable: true,
                        example: "eyJpZCI6IjEyMyIsImNyZWF0ZWRBdCI6Ii4uLiJ9",
                    },
                },
            },
        }),
    );

/* ── summary ── */
export const MediaSummaryDocs = () =>
    applyDecorators(
        op(
            "Group-by counts and storage size",
            "Same filters and visibility as the list; groupBy = purpose | type | status | uploader.",
            400,
            403,
        ),
        ApiOkResponse({
            schema: {
                type: "object",
                example: {
                    groupBy: "purpose",
                    groups: [
                        { key: "PRODUCT", count: 90, bytes: 52428800 },
                        { key: "AVATAR", count: 47, bytes: 9437184 },
                    ],
                    total: 137,
                    totalBytes: 61865984,
                },
            },
        }),
    );

/* ── usage ── */
export const MediaUsageDocs = () =>
    applyDecorators(
        op(
            "Where is this media used?",
            "Admins: any file. Store managers: files visible to them in the library. Lists every reference; delete is refused while total > 0.",
            403,
            404,
        ),
        idParam(),
        ApiOkResponse({
            schema: {
                type: "object",
                example: {
                    mediaId: "123",
                    products: [
                        { id: "10", slug: "apple", relation: "thumbnail" },
                    ],
                    variants: [],
                    categories: [],
                    brands: [],
                    stores: [],
                    bundles: [],
                    users: [],
                    kyc: [],
                    deliveryProofs: [],
                    optionValues: [],
                    supportMessages: [],
                    orderItemSnapshots: [],
                    total: 1,
                },
            },
        }),
    );

/* ── file ── */
const hdr = (description: string, example: string) => ({
    description,
    schema: { type: "string", example },
});

export const MediaFileDocs = () =>
    applyDecorators(
        op(
            "Serve a media file",
            "Private: uploader or purpose readers only (KYC = admins). Avatars: owner and admins only. Public remote files 302 to the CDN. Supports Range and ETag.",
            403,
            404,
        ),
        idParam(),
        ApiQuery({
            name: "variant",
            required: false,
            enum: ["master", "thumb"],
            description: "Default master",
        }),
        ApiQuery({
            name: "size",
            required: false,
            enum: ["thumbnail"],
            description: "Legacy alias of variant=thumb",
        }),
        ApiHeader({
            name: "Range",
            required: false,
            description: "Partial content",
            schema: { type: "string", example: "bytes=0-1048575" },
        }),
        ApiHeader({
            name: "If-None-Match",
            required: false,
            description: "Revalidate by ETag",
            schema: { type: "string" },
        }),
        ApiProduces(
            "image/webp",
            "image/jpeg",
            "image/png",
            "application/pdf",
            "video/mp4",
            "audio/mpeg",
        ),
        ApiOkResponse({
            description: "Full file",
            schema: { type: "string", format: "binary" },
            headers: {
                "Content-Type": hdr("MIME type", "image/webp"),
                "Content-Length": hdr("Bytes", "145000"),
                "Accept-Ranges": hdr("Range support", "bytes"),
                ETag: hdr("Entity tag", '"9e107d9d372bb6826bd81d3542a419d6"'),
                "Cache-Control": hdr(
                    "public (300s) or private (60s, must-revalidate)",
                    "public, max-age=300",
                ),
                "X-Content-Type-Options": hdr("Always nosniff", "nosniff"),
            },
        }),
        ApiResponse({
            status: 206,
            description: "Partial content",
            headers: {
                "Content-Range": hdr("Served range", "bytes 0-1048575/5242880"),
            },
        }),
        ApiResponse({
            status: 302,
            description: "Redirect to CDN (public remote files)",
            headers: {
                Location: hdr("CDN URL", "https://cdn.example.com/x.webp"),
            },
        }),
        ApiResponse({
            status: 304,
            description: "Not modified (ETag matched)",
        }),
        ApiResponse({
            status: 416,
            description: "Range not satisfiable",
            headers: { "Content-Range": hdr("Total size", "bytes */5242880") },
        }),
        conflict("Media is not READY", "Media is not ready"),
    );

/* ── get ── */
export const MediaGetDocs = () =>
    applyDecorators(
        op("Get media details", "Admins: any file. Store managers: catalog media and their own uploads (403 otherwise). Includes `canEdit`.", 403, 404),
        idParam(),
        ApiOkResponse({ schema: mediaItem }),
    );

/* ── patch ── */
export const MediaPatchDocs = () =>
    applyDecorators(
        op(
            "Update localized title / alt",
            "Admins: any file. Store managers: only files they uploaded (403 `media.access.notOwner`). Send a language map; omit a field to keep it, send null to clear it. Max lengths come from config.",
            400,
            403,
            404,
        ),
        idParam(),
        ApiBody({
            type: UpdateMediaDto,
            schema: {
                type: "object",
                properties: {
                    title: localized({ en: "Red apple", hi: "लाल सेब" }),
                    alt: localized({ en: "Fresh red apple" }),
                },
            },
        }),
        ApiOkResponse({ description: "Updated", schema: mediaItem }),
    );

/* ── replace ── */
export const MediaReplaceDocs = () =>
    applyDecorators(
        op(
            "Replace bytes, keep the ID",
            "Admins: any file. Store managers: only files they uploaded (403 `media.access.notOwner`). Not for avatars. Same kind as the original; same size/dimension rules; images are re-cropped. Old objects are removed unless an order snapshot references them.",
            400,
            403,
            404,
            413,
        ),
        idParam(),
        ApiConsumes("multipart/form-data"),
        ApiBody({
            schema: {
                type: "object",
                required: ["file"],
                properties: { file },
            },
        }),
        ApiOkResponse({ description: "Replaced", schema: mediaItem }),
        conflict("Media is not READY", "Media is not ready"),
    );

/* ── delete ── */
export const MediaDeleteDocs = () =>
    applyDecorators(
        op(
            "Soft-delete unused media",
            "Admins: any file. Store managers: only files they uploaded (403 `media.access.notOwner`). Refused (409 MEDIA_IN_USE) while referenced — detach it first; storage is purged asynchronously by the cleanup job.",
            403,
            404,
        ),
        idParam(),
        ApiOkResponse({
            schema: { type: "object", example: { success: true, id: "123" } },
        }),
        conflict("Media is in use", "Media is in use", {
            code: { type: "string", example: "MEDIA_IN_USE" },
            usage: {
                type: "object",
                example: {
                    total: 1,
                    products: [{ id: "10", relation: "thumbnail" }],
                },
            },
        }),
    );
