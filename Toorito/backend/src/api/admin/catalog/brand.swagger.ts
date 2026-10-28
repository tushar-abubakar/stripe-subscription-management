import { BRAND_SORTS } from "@modules/catalog/brand/brand.types";
/**
 * Swagger / OpenAPI documentation for the brand module.
 *
 * Everything Swagger-related for brands lives here so the controller stays
 * readable. Each endpoint gets ONE composed decorator (`@ApiXxx()`) that
 * documents its summary, headers, params, body (with examples), success
 * response and every error response the service can throw.
 *
 * The classes in this file are documentation models only. They are never
 * instantiated or validated; validation stays in `brand.dto.ts`.
 * Bigint ids are documented as numeric strings because that is how they
 * are serialized over JSON.
 */
import { BRAND_BULK_MAX } from "./brand.dto";
import { applyDecorators } from "@nestjs/common";
import {
    ApiBadRequestResponse,
    ApiBearerAuth,
    ApiBody,
    ApiConflictResponse,
    ApiCreatedResponse,
    ApiExtraModels,
    ApiForbiddenResponse,
    ApiHeader,
    ApiNotFoundResponse,
    ApiOkResponse,
    ApiOperation,
    ApiParam,
    ApiProperty,
    ApiPropertyOptional,
    ApiQuery,
    ApiTags,
    ApiUnauthorizedResponse,
    getSchemaPath,
} from "@nestjs/swagger";
import { BrandStatus } from "@prisma-client/enums";

// =====================================================================
// Shared schema fragments
// =====================================================================

/** `{ "en": "...", "hi": "..." }` — keys are language codes. */
const LOCALE_MAP = {
    type: "object",
    additionalProperties: { type: "string" },
} as const;

const BIGINT_ID = {
    type: String,
    pattern: "^\\d+$",
} as const;

const LOGO_URL_EXAMPLE =
    "http://localhost:3000/media-public/brand/images/2026/10/1f2e-thumb.webp";
const BANNER_URL_EXAMPLE =
    "http://localhost:3000/media-public/brand/images/2026/10/8b3a-master.webp";

/**
 * Standard NestJS error body. `message` is translated using the request
 * language (Accept-Language). Validation errors (400 from the
 * ValidationPipe) return `message` as an array of strings.
 */
function errorSchema(
    statusCode: number,
    error: string,
    message: string | string[],
) {
    return {
        type: "object",
        required: ["statusCode", "message", "error"],
        properties: {
            statusCode: { type: "number", example: statusCode },
            message: {
                oneOf: [
                    { type: "string" },
                    { type: "array", items: { type: "string" } },
                ],
                example: message,
            },
            error: { type: "string", example: error },
        },
    };
}

/** Builds a "possible causes" list for an error response description. */
function causes(title: string, list: string[]) {
    return `${title}\n\nPossible causes:\n${list.map((c) => `- ${c}`).join("\n")}`;
}

const ACCEPT_LANGUAGE_HEADER = ApiHeader({
    name: "Accept-Language",
    required: false,
    description:
        "Language for localized fields and error messages. Falls back to the default language.",
    example: "en",
});

const ID_PARAM = ApiParam({
    name: "id",
    description: "Brand ID (bigint, sent as a numeric string)",
    schema: { type: "string", pattern: "^\\d+$" },
    example: "7",
});

const NOT_FOUND = ApiNotFoundResponse({
    description: "Brand not found (`catalog.brand.notFound`)",
    schema: errorSchema(404, "Not Found", "Brand not found"),
});

const RICH_TEXT_RULES =
    "Sanitized on save. Allowed tags: p, br, strong, em, u, s, sub, sup, code, h3, h4, ul, ol, li, blockquote, a. " +
    "b / i / h1 / h2 / div are converted; other tags are removed (their text is kept). " +
    "No style / class / id attributes; links allow http(s), mailto, tel, relative or # only " +
    "(external links get target=_blank + rel=noopener).";

// =====================================================================
// Request body models
// =====================================================================

export class BrandUpsertBodyDoc {
    @ApiPropertyOptional({
        type: String,
        example: "amul",
        description:
            "URL slug. On create, generated from the default-language name when omitted. On update, unchanged when omitted. Must be unique (409 otherwise).",
    })
    slug?: string;

    @ApiProperty({
        ...LOCALE_MAP,
        example: { en: "Amul", hi: "अमूल" },
        description:
            "Localized names. The default language is required; unknown languages are dropped.",
    })
    name!: Record<string, string>;

    @ApiPropertyOptional({
        ...LOCALE_MAP,
        example: {
            en: "<p>India's favourite <strong>dairy</strong> brand.</p><ul><li>Milk</li><li>Butter</li></ul>",
        },
        description: `Localized rich-text HTML. ${RICH_TEXT_RULES}`,
    })
    description?: Record<string, string>;

    @ApiPropertyOptional({
        enum: BrandStatus,
        example: BrandStatus.ACTIVE,
        description:
            "Defaults to ACTIVE on create; omitted on update keeps the current status.",
    })
    status?: BrandStatus;

    @ApiProperty({
        ...BIGINT_ID,
        example: "31",
        description:
            "Media ID of an uploaded image with purpose BRAND. Required.",
    })
    logoId!: string;

    @ApiPropertyOptional({
        ...BIGINT_ID,
        example: "32",
        description: "Media ID of an uploaded image with purpose BRAND_BANNER.",
    })
    bannerId?: string;
}

export class BrandStatusBodyDoc {
    @ApiProperty({ enum: BrandStatus, example: BrandStatus.INACTIVE })
    status!: BrandStatus;

    @ApiPropertyOptional({
        type: Boolean,
        default: false,
        description:
            "Only when leaving ACTIVE. Removes the brand from every product that uses it (including soft-deleted; " +
            "`brandId` becomes null and the brand name is removed from the product search text), then changes the status. " +
            "Without it, brands in use block the change.",
    })
    detachProducts?: boolean;
}

export class BrandBulkStatusBodyDoc extends BrandStatusBodyDoc {
    @ApiProperty({
        type: [String],
        example: ["7", "9"],
        minItems: 1,
        maxItems: BRAND_BULK_MAX,
        description: `Brand IDs (1–${BRAND_BULK_MAX}, duplicates ignored).`,
    })
    ids!: string[];

    @ApiPropertyOptional({
        type: Boolean,
        default: false,
        description:
            "Run every check and return the plan + blockers without saving anything.",
    })
    dryRun?: boolean;
}

// =====================================================================
// Response models
// =====================================================================

export class StorefrontBrandResponse {
    @ApiProperty({ ...BIGINT_ID, example: "7" })
    id!: string;

    @ApiProperty({ example: "amul" })
    slug!: string;

    @ApiProperty({
        example: "Amul",
        description: "Localized to Accept-Language",
    })
    name!: string;

    @ApiProperty({ type: String, nullable: true, example: LOGO_URL_EXAMPLE })
    logoUrl!: string | null;

    @ApiProperty({ type: String, nullable: true, example: BANNER_URL_EXAMPLE })
    bannerUrl!: string | null;
}

export class BrandListItemResponse {
    @ApiProperty({ ...BIGINT_ID, example: "7" })
    id!: string;

    @ApiProperty({ example: "amul" })
    slug!: string;

    @ApiProperty({ ...LOCALE_MAP, example: { en: "Amul", hi: "अमूल" } })
    name!: Record<string, string>;

    @ApiProperty({
        ...LOCALE_MAP,
        nullable: true,
        example: { en: "India's favourite dairy brand. Milk Butter" },
        description:
            "Plain-text description (HTML stripped), max 160 chars per language",
    })
    shortDescription!: Record<string, string> | null;

    @ApiProperty({ enum: BrandStatus, example: BrandStatus.ACTIVE })
    status!: BrandStatus;

    @ApiProperty({ ...BIGINT_ID, nullable: true, example: "31" })
    logoId!: string | null;

    @ApiProperty({
        type: String,
        nullable: true,
        example: LOGO_URL_EXAMPLE,
        description: "Logo thumbnail variant URL",
    })
    logoUrl!: string | null;

    @ApiProperty({
        example: 42,
        description: "Products using this brand (excludes soft-deleted)",
    })
    productCount!: number;

    @ApiProperty({
        type: String,
        format: "date-time",
        example: "2026-10-12T08:30:00.000Z",
    })
    createdAt!: string;

    @ApiProperty({
        type: String,
        format: "date-time",
        example: "2026-10-12T09:15:00.000Z",
    })
    updatedAt!: string;
}

export class BrandListResponse {
    @ApiProperty({ type: () => [BrandListItemResponse] })
    items!: BrandListItemResponse[];

    @ApiProperty({ example: 1 })
    total!: number;

    @ApiProperty({ example: 1 })
    page!: number;

    @ApiProperty({ example: 20 })
    limit!: number;
}

export class BrandDetailResponse {
    @ApiProperty({ ...BIGINT_ID, example: "7" })
    id!: string;

    @ApiProperty({ example: "amul" })
    slug!: string;

    @ApiProperty({ ...LOCALE_MAP, example: { en: "Amul", hi: "अमूल" } })
    name!: Record<string, string>;

    @ApiProperty({
        ...LOCALE_MAP,
        nullable: true,
        example: {
            en: "<p>India's favourite <strong>dairy</strong> brand.</p>",
        },
    })
    description!: Record<string, string> | null;

    @ApiProperty({ enum: BrandStatus, example: BrandStatus.ACTIVE })
    status!: BrandStatus;

    @ApiProperty({ ...BIGINT_ID, example: "31" })
    logoId!: string;

    @ApiProperty({
        type: String,
        nullable: true,
        example: LOGO_URL_EXAMPLE,
        description: "Thumbnail variant URL",
    })
    logoUrl!: string | null;

    @ApiProperty({ ...BIGINT_ID, nullable: true, example: "32" })
    bannerId!: string | null;

    @ApiProperty({
        type: String,
        nullable: true,
        example: BANNER_URL_EXAMPLE,
        description: "Master variant URL",
    })
    bannerUrl!: string | null;

    @ApiProperty({
        example: 43,
        description: "Products using this brand, including soft-deleted ones",
    })
    productCount!: number;

    @ApiProperty({
        type: String,
        format: "date-time",
        example: "2026-10-12T08:30:00.000Z",
    })
    createdAt!: string;

    @ApiProperty({
        type: String,
        format: "date-time",
        example: "2026-10-12T09:15:00.000Z",
    })
    updatedAt!: string;
}

/** Raw brand row returned by create / update. */
export class BrandRecordResponse {
    @ApiProperty({ ...BIGINT_ID, example: "7" })
    id!: string;

    @ApiProperty({ example: "amul" })
    slug!: string;

    @ApiProperty({ ...LOCALE_MAP, example: { en: "Amul", hi: "अमूल" } })
    name!: Record<string, string>;

    @ApiProperty({
        ...LOCALE_MAP,
        nullable: true,
        example: { en: "<p>India's favourite dairy brand.</p>" },
    })
    description!: Record<string, string> | null;

    @ApiProperty({ enum: BrandStatus, example: BrandStatus.ACTIVE })
    status!: BrandStatus;

    @ApiProperty({ ...BIGINT_ID, example: "31" })
    logoId!: string;

    @ApiProperty({ ...BIGINT_ID, nullable: true, example: "32" })
    bannerId!: string | null;

    @ApiProperty({
        type: String,
        format: "date-time",
        example: "2026-10-19T08:30:00.000Z",
    })
    createdAt!: string;

    @ApiProperty({
        type: String,
        format: "date-time",
        example: "2026-10-19T08:30:00.000Z",
    })
    updatedAt!: string;
}

export class CheckBrandSlugResponse {
    @ApiProperty({
        example: true,
        description: "Whether the slug is already taken",
    })
    exists!: boolean;

    @ApiProperty({
        example: "amul",
        description: "Normalized slug that was checked",
    })
    slug!: string;

    @ApiProperty({
        type: String,
        nullable: true,
        example: "amul-2",
        description: "Next free slug when taken, otherwise null. Not reserved.",
    })
    suggestion!: string | null;
}

export class BrandStatusResponse {
    @ApiProperty({ example: true })
    success!: boolean;

    @ApiProperty({ ...BIGINT_ID, example: "7" })
    id!: string;

    @ApiProperty({ enum: BrandStatus, example: BrandStatus.INACTIVE })
    status!: BrandStatus;

    @ApiProperty({
        example: 42,
        description: "Products whose brand was removed",
    })
    detachedProductCount!: number;
}

export class BrandStatusBlockerResponse {
    @ApiProperty({ ...BIGINT_ID, example: "7" })
    id!: string;

    @ApiProperty({
        enum: ["inUse"],
        example: "inUse",
        description:
            "inUse → resend with `detachProducts: true` to remove the brand from its products.",
    })
    code!: string;

    @ApiProperty({
        example:
            '"Amul" is used by 42 product(s). Remove the brand from these products to continue.',
        description: "Translated message (Accept-Language)",
    })
    message!: string;

    @ApiProperty({
        example: 42,
        description: "Including soft-deleted products",
    })
    productCount!: number;
}

export class BrandBulkStatusResponse {
    @ApiProperty({ example: true })
    success!: boolean;

    @ApiProperty({
        example: true,
        description: "False only on a dry run that found blockers",
    })
    canApply!: boolean;

    @ApiProperty({ example: false })
    dryRun!: boolean;

    @ApiProperty({ enum: BrandStatus, example: BrandStatus.INACTIVE })
    status!: BrandStatus;

    @ApiProperty({
        type: [String],
        example: ["7", "9"],
        description: "Changed (or would change on a dry run)",
    })
    updatedIds!: string[];

    @ApiProperty({
        type: [String],
        example: ["11"],
        description: "Already in the target status",
    })
    unchangedIds!: string[];

    @ApiProperty({
        example: 42,
        description: "Products whose brand was (or would be) removed",
    })
    detachedProductCount!: number;

    @ApiProperty({
        type: () => [BrandStatusBlockerResponse],
        description: "Empty unless dry run",
    })
    blockers!: BrandStatusBlockerResponse[];
}

export class BrandDeleteResponse {
    @ApiProperty({ example: true })
    success!: boolean;

    @ApiProperty({ ...BIGINT_ID, example: "7" })
    id!: string;
}

/** 409 body for status changes: standard error + every blocker. */
function blockedSchema(message: string) {
    const base = errorSchema(409, "Conflict", message);
    return {
        ...base,
        properties: {
            ...base.properties,
            blockers: {
                type: "array",
                items: { $ref: getSchemaPath(BrandStatusBlockerResponse) },
            },
        },
    };
}

// =====================================================================
// Controller-level decorators
// =====================================================================

/** Storefront controller: public, no auth header. */
export function ApiStorefrontBrandsController() {
    return applyDecorators(ApiTags("StorefrontBrands"), ACCEPT_LANGUAGE_HEADER);
}

/** Admin controller: bearer auth + common 401 / 403 responses. */
export function ApiAdminBrandsController() {
    return applyDecorators(
        ApiTags("AdminBrands"),
        ApiBearerAuth(),
        ACCEPT_LANGUAGE_HEADER,
        ApiUnauthorizedResponse({
            description: "Missing, invalid or expired bearer token",
            schema: errorSchema(401, "Unauthorized", "Unauthorized"),
        }),
        ApiForbiddenResponse({
            description:
                "Role is not ADMIN / SUPER_ADMIN, or the required permission is missing",
            schema: errorSchema(403, "Forbidden", "Forbidden resource"),
        }),
    );
}

// =====================================================================
// Storefront endpoints
// =====================================================================

/** GET /public/catalog/brands */
export function ApiStorefrontBrandList() {
    return applyDecorators(
        ApiOperation({
            summary: "List active brands",
            description:
                "Public. Returns only ACTIVE brands, localized to `Accept-Language` and sorted by localized name. Cached server-side.",
        }),
        ApiOkResponse({
            description: "Active brands",
            type: StorefrontBrandResponse,
            isArray: true,
            example: [
                {
                    id: "7",
                    slug: "amul",
                    name: "Amul",
                    logoUrl: LOGO_URL_EXAMPLE,
                    bannerUrl: BANNER_URL_EXAMPLE,
                },
            ],
        }),
    );
}

// =====================================================================
// Admin endpoints
// =====================================================================

/** GET /admin/brands */
export function ApiAdminBrandList() {
    return applyDecorators(
        ApiOperation({
            summary: "List brands (paginated)",
            description:
                "Requires `BRAND_READ`. Search matches the slug and names in allowed languages. " +
                "Returns a plain-text `shortDescription` (no HTML) and the product count.",
        }),
        ApiQuery({
            name: "page",
            required: false,
            type: Number,
            example: 1,
            description: "Page number (1-based)",
        }),
        ApiQuery({
            name: "limit",
            required: false,
            type: Number,
            example: 20,
            description: "Items per page",
        }),
        ApiQuery({
            name: "q",
            required: false,
            type: String,
            example: "amul",
            description:
                "Search term (max 100 chars), matches slug or localized name",
        }),
        ApiQuery({ name: "status", required: false, enum: BrandStatus }),
        ApiQuery({
            name: "excludeIds",
            required: false,
            type: [String],
            example: ["7", "9"],
            description: "Exclude these exact brand IDs (max 100)",
        }),
        ApiQuery({
            name: "sort",
            required: false,
            enum: BRAND_SORTS,
            example: "id_desc",
            description: "Sort order. Ties are broken by `id desc`.",
        }),
        ApiOkResponse({
            description: "Paginated brand list",
            type: BrandListResponse,
            example: {
                items: [
                    {
                        id: "7",
                        slug: "amul",
                        name: { en: "Amul", hi: "अमूल" },
                        shortDescription: {
                            en: "India's favourite dairy brand. Milk Butter",
                        },
                        status: "ACTIVE",
                        logoId: "31",
                        logoUrl: LOGO_URL_EXAMPLE,
                        brandId: "23",
                        brandUrl: "https://cdn.nnnn....",
                        productCount: 42,
                        createdAt: "2026-10-12T08:30:00.000Z",
                        updatedAt: "2026-10-12T09:15:00.000Z",
                    },
                ],
                total: 1,
                page: 1,
                limit: 20,
            },
        }),
        ApiBadRequestResponse({
            description: "Invalid query parameters",
            schema: errorSchema(400, "Bad Request", [
                "sort must be one of the following values: id_desc, id_asc, ...",
            ]),
        }),
    );
}

/** GET /admin/brands/check-slug */
export function ApiCheckBrandSlug() {
    return applyDecorators(
        ApiOperation({
            summary: "Check slug availability",
            description:
                "Requires `BRAND_CREATE` or `BRAND_UPDATE`. Send `slug`, or `title` to have a slug generated. " +
                "When taken, suggests the next free `-N` suffix. Reads the database directly (no cache); the suggestion is not reserved.",
        }),
        ApiQuery({
            name: "title",
            required: false,
            type: String,
            example: "Amul",
            description:
                "Used to generate a slug when `slug` is not sent (max 200 chars)",
        }),
        ApiQuery({
            name: "slug",
            required: false,
            type: String,
            example: "amul",
        }),
        ApiQuery({
            name: "excludeId",
            required: false,
            type: String,
            example: "7",
            description:
                "The brand being edited, so its own slug is not reported as taken",
        }),
        ApiOkResponse({
            description: "Availability result",
            type: CheckBrandSlugResponse,
            examples: {
                available: {
                    summary: "Slug is free",
                    value: { exists: false, slug: "amul", suggestion: null },
                },
                taken: {
                    summary: "Slug is taken",
                    value: { exists: true, slug: "amul", suggestion: "amul-2" },
                },
            },
        }),
        ApiBadRequestResponse({
            description: causes("Nothing usable to check", [
                "Neither `title` nor `slug` sent (`catalog.brand.slugInputRequired`)",
                "Input produces an empty slug (`catalog.brand.slugInvalid`)",
            ]),
            schema: errorSchema(400, "Bad Request", "Provide a title or slug"),
        }),
    );
}

/** GET /admin/brands/:id */
export function ApiAdminBrandGet() {
    return applyDecorators(
        ApiOperation({
            summary: "Get a brand for the edit form",
            description:
                "Requires `BRAND_READ`. Returns all localized maps, media URLs and the product count (including soft-deleted).",
        }),
        ID_PARAM,
        ApiOkResponse({
            description: "Brand details",
            type: BrandDetailResponse,
        }),
        NOT_FOUND,
    );
}

const UPSERT_BAD_REQUEST = ApiBadRequestResponse({
    description: causes("Invalid payload", [
        "Body validation failed (missing `name` / `logoId`, bad id format, unknown status, ...)",
        "Default-language name missing in `name`",
        "`logoId` / `bannerId` is not a valid image for the BRAND / BRAND_BANNER purpose",
    ]),
    schema: errorSchema(400, "Bad Request", ["logoId must be a valid id"]),
});

/** POST /admin/brands */
export function ApiCreateBrand() {
    return applyDecorators(
        ApiOperation({
            summary: "Create a brand",
            description:
                "Requires `BRAND_CREATE`. `description` HTML is sanitized. Busts catalog and product caches.",
        }),
        ApiBody({
            type: BrandUpsertBodyDoc,
            examples: {
                minimal: {
                    summary: "Minimal",
                    value: { name: { en: "Amul", hi: "अमूल" }, logoId: "31" },
                },
                full: {
                    summary: "With slug, description and banner",
                    value: {
                        slug: "amul",
                        name: { en: "Amul", hi: "अमूल" },
                        description: {
                            en: "<p>India's favourite <strong>dairy</strong> brand.</p>",
                        },
                        status: "ACTIVE",
                        logoId: "31",
                        bannerId: "32",
                    },
                },
            },
        }),
        ApiCreatedResponse({
            description: "Created brand row",
            type: BrandRecordResponse,
        }),
        UPSERT_BAD_REQUEST,
        ApiConflictResponse({
            description: "Slug already used (`catalog.brand.slugTaken`)",
            schema: errorSchema(409, "Conflict", "Slug is already taken"),
        }),
    );
}

/** PUT /admin/brands/:id */
export function ApiUpdateBrand() {
    return applyDecorators(
        ApiOperation({
            summary: "Update a brand (full replace)",
            description:
                "Requires `BRAND_UPDATE`. Full replacement: omitted `description` and `bannerId` are cleared. " +
                "Omitted `slug` and `status` keep their current values. A name change refreshes the products' search text. " +
                "Leaving ACTIVE is refused while products use the brand; use the status endpoint with `detachProducts` for that.",
        }),
        ID_PARAM,
        ApiBody({
            type: BrandUpsertBodyDoc,
            examples: {
                rename: {
                    summary: "Rename",
                    value: {
                        name: { en: "Amul Dairy", hi: "अमूल डेयरी" },
                        logoId: "31",
                        bannerId: "32",
                    },
                },
            },
        }),
        ApiOkResponse({
            description: "Updated brand row",
            type: BrandRecordResponse,
        }),
        UPSERT_BAD_REQUEST,
        NOT_FOUND,
        ApiConflictResponse({
            description: causes("Conflict", [
                "Slug already used (`catalog.brand.slugTaken`)",
                "Leaving ACTIVE while products use it (`catalog.brand.inUse`)",
            ]),
            schema: errorSchema(409, "Conflict", "Brand is in use"),
        }),
    );
}

const STATUS_RULES =
    "- Leaving ACTIVE: products (including soft-deleted) that use the brand block the change (`inUse`), " +
    "unless `detachProducts: true` is sent. The brand is then removed from those products (`brandId = null`, " +
    "brand name removed from their search text) before the status changes.\n" +
    "- Becoming ACTIVE: no checks.\n\n" +
    "Recommended UI flow: `dryRun` (bulk) or try the change → on `inUse` blockers show " +
    '"N products will lose their brand" → resend with `detachProducts: true`.';

const STATUS_BAD_REQUEST = ApiBadRequestResponse({
    description:
        "Body validation failed (`status` missing / invalid, bad id format, empty or too many `ids`)",
    schema: errorSchema(400, "Bad Request", [
        "status must be one of the following values: ACTIVE, INACTIVE",
    ]),
});

/** PATCH /admin/brands/:id/status */
export function ApiSetBrandStatus() {
    return applyDecorators(
        ApiExtraModels(BrandStatusBlockerResponse),
        ApiOperation({
            summary: "Change brand status",
            description: `Requires \`BRAND_UPDATE\`. Idempotent. Same rules as the bulk endpoint.\n\n${STATUS_RULES}`,
        }),
        ID_PARAM,
        ApiBody({
            type: BrandStatusBodyDoc,
            examples: {
                deactivate: {
                    summary: "Deactivate",
                    value: { status: "INACTIVE" },
                },
                detachAndDeactivate: {
                    summary: "Remove from products, then deactivate",
                    value: { status: "INACTIVE", detachProducts: true },
                },
                activate: { summary: "Activate", value: { status: "ACTIVE" } },
            },
        }),
        ApiOkResponse({
            description: "Status applied (or already set)",
            type: BrandStatusResponse,
        }),
        STATUS_BAD_REQUEST,
        NOT_FOUND,
        ApiConflictResponse({
            description: "Products use the brand (`inUse`) — see `blockers`",
            schema: blockedSchema(
                '"Amul" is used by 42 product(s). Remove the brand from these products to continue.',
            ),
        }),
    );
}

/** PATCH /admin/brands/bulk/status */
export function ApiBulkSetBrandStatus() {
    return applyDecorators(
        ApiExtraModels(BrandStatusBlockerResponse),
        ApiOperation({
            summary: "Change status of many brands",
            description:
                `Requires \`BRAND_UPDATE\`. Up to ${BRAND_BULK_MAX} ids, one transaction, **all-or-nothing**: ` +
                "if any brand is blocked nothing is saved and the 409 lists every blocker. " +
                "Brands already in the target status are returned in `unchangedIds`. " +
                "Send `dryRun: true` to get the plan and blockers without saving.\n\n" +
                STATUS_RULES,
        }),
        ApiBody({
            type: BrandBulkStatusBodyDoc,
            examples: {
                preview: {
                    summary: "Preview (dry run)",
                    value: {
                        ids: ["7", "9"],
                        status: "INACTIVE",
                        dryRun: true,
                    },
                },
                deactivate: {
                    summary: "Deactivate",
                    value: { ids: ["7", "9"], status: "INACTIVE" },
                },
                detachAndDeactivate: {
                    summary: "Remove from products, then deactivate",
                    value: {
                        ids: ["7", "9"],
                        status: "INACTIVE",
                        detachProducts: true,
                    },
                },
                activate: {
                    summary: "Activate",
                    value: { ids: ["7", "9"], status: "ACTIVE" },
                },
            },
        }),
        ApiOkResponse({
            description: "Applied, or the dry-run plan",
            type: BrandBulkStatusResponse,
            examples: {
                applied: {
                    summary: "Applied",
                    value: {
                        success: true,
                        canApply: true,
                        dryRun: false,
                        status: "INACTIVE",
                        updatedIds: ["7", "9"],
                        unchangedIds: [],
                        detachedProductCount: 42,
                        blockers: [],
                    },
                },
                dryRunBlocked: {
                    summary: "Dry run with blockers",
                    value: {
                        success: true,
                        canApply: false,
                        dryRun: true,
                        status: "INACTIVE",
                        updatedIds: ["7", "9"],
                        unchangedIds: [],
                        detachedProductCount: 0,
                        blockers: [
                            {
                                id: "7",
                                code: "inUse",
                                message:
                                    '"Amul" is used by 42 product(s). Remove the brand from these products to continue.',
                                productCount: 42,
                            },
                        ],
                    },
                },
            },
        }),
        STATUS_BAD_REQUEST,
        ApiNotFoundResponse({
            description:
                "Some ids do not exist (`catalog.brand.bulkNotFound`, lists the ids)",
            schema: errorSchema(404, "Not Found", "Brands not found: 99, 100"),
        }),
        ApiConflictResponse({
            description:
                "Nothing saved: brands in use (`inUse`) — see `blockers`",
            schema: blockedSchema("2 brands cannot change status"),
        }),
    );
}

/** DELETE /admin/brands/:id */
export function ApiDeleteBrand() {
    return applyDecorators(
        ApiOperation({
            summary: "Delete a brand permanently",
            description:
                "Requires `BRAND_DELETE`. Only allowed when no product (including soft-deleted) uses the brand. " +
                "Logo and banner stay in the media library. Prefer INACTIVE status to retire a brand you may restore.",
        }),
        ID_PARAM,
        ApiOkResponse({ description: "Deleted", type: BrandDeleteResponse }),
        NOT_FOUND,
        ApiConflictResponse({
            description: causes("Brand still in use", [
                "Products (including soft-deleted) use it (`catalog.brand.inUse`)",
                "Any other foreign key still points at it (`catalog.brand.inUse`)",
            ]),
            schema: errorSchema(409, "Conflict", "Brand is in use"),
        }),
    );
}
