import { CATEGORY_SORTS } from "@modules/catalog/category/category.types";
/**
 * Swagger / OpenAPI documentation for the category module.
 *
 * Everything Swagger-related for categories lives here so the controller
 * stays readable. Each endpoint gets ONE composed decorator
 * (`@ApiXxx()`) that documents its:
 *   - operation summary / description
 *   - headers (Authorization, Accept-Language)
 *   - path + query params
 *   - request body (with ready-to-use examples)
 *   - success response (typed model + example)
 *   - every error response the service can throw
 *
 * The classes in this file are documentation models only. They are never
 * instantiated or validated; validation stays in `category.dto.ts`.
 * Bigint ids are documented as numeric strings because that is how they
 * are serialized over JSON.
 */
import { CATEGORY_BULK_MAX } from "./category.dto";
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
import { CategoryStatus } from "@prisma-client/enums";

// =====================================================================
// Shared schema fragments
// =====================================================================

/** `{ "en": "...", "ar": "..." }` — keys are language codes. */
const LOCALE_MAP = {
    type: "object",
    additionalProperties: { type: "string" },
} as const;

const BIGINT_ID = {
    type: String,
    pattern: "^\\d+$",
} as const;

const ICON_URL_EXAMPLE =
    "http://localhost:3000/media-public/category/images/2026/10/7aa88053-thumb.webp";
const BANNER_URL_EXAMPLE =
    "http://localhost:3000/media-public/category/images/2026/10/9c1d-master.webp";
const BANNER_THUMB_URL_EXAMPLE =
    "http://localhost:3000/media-public/category/images/2026/10/9c1d-thumb.webp";

/**
 * Standard NestJS error body. `message` is translated using the
 * request language (Accept-Language). Validation errors (400 from the
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
    description: "Category ID (bigint, sent as a numeric string)",
    schema: { type: "string", pattern: "^\\d+$" },
    example: "12",
});

const NOT_FOUND = ApiNotFoundResponse({
    description: "Category not found (`catalog.category.notFound`)",
    schema: errorSchema(404, "Not Found", "Category not found"),
});

const RICH_TEXT_RULES =
    "Sanitized on save. Allowed tags: p, br, strong, em, u, s, sub, sup, code, h3, h4, ul, ol, li, blockquote, a. " +
    "b / i / h1 / h2 / div are converted; other tags are removed (their text is kept). " +
    "No style / class / id attributes; links allow http(s), mailto, tel, relative or # only " +
    "(external links get target=_blank + rel=noopener).";

// =====================================================================
// Request body models
// =====================================================================

export class CategoryUpsertBodyDoc {
    @ApiPropertyOptional({
        ...BIGINT_ID,
        nullable: true,
        example: "3",
        description:
            "Parent category ID. Omit or null for a root category. Cannot be the category itself or one of its descendants.",
    })
    parentId?: string | null;

    @ApiPropertyOptional({
        type: String,
        example: "running-shoes",
        description:
            "URL slug. On create, generated from the default-language name when omitted. On update, unchanged when omitted. Must be unique (409 otherwise).",
    })
    slug?: string;

    @ApiProperty({
        ...LOCALE_MAP,
        example: { en: "Running Shoes", ar: "أحذية الجري" },
        description:
            "Localized names. The default language is required; unknown languages are dropped.",
    })
    name!: Record<string, string>;

    @ApiPropertyOptional({
        ...LOCALE_MAP,
        example: {
            en: "<p>Shoes built for <strong>running</strong>.</p><ul><li>Lightweight</li><li>Breathable</li></ul>",
        },
        description: `Localized rich-text HTML. ${RICH_TEXT_RULES}`,
    })
    description?: Record<string, string>;

    @ApiPropertyOptional({
        enum: CategoryStatus,
        example: CategoryStatus.ACTIVE,
        description:
            "Defaults to ACTIVE on create; omitted on update keeps the current status.",
    })
    status?: CategoryStatus;

    @ApiProperty({
        ...BIGINT_ID,
        example: "45",
        description:
            "Media ID of an uploaded image with purpose CATEGORY. Required.",
    })
    iconId!: string;

    @ApiPropertyOptional({
        ...BIGINT_ID,
        example: "46",
        description:
            "Media ID of an uploaded image with purpose CATEGORY_BANNER.",
    })
    bannerId?: string;

    @ApiPropertyOptional({
        type: Number,
        example: 0,
        default: 0,
        description: "Sort order among siblings (lower first).",
    })
    position?: number;
}

export class CategoryStatusBodyDoc {
    @ApiProperty({ enum: CategoryStatus, example: CategoryStatus.INACTIVE })
    status!: CategoryStatus;

    @ApiPropertyOptional({
        ...BIGINT_ID,
        example: "7",
        description:
            "Only when leaving ACTIVE. Moves every product (including soft-deleted) and store listing of the affected " +
            "categories to this category before the status change. Must exist, be ACTIVE and not be one of the categories being changed. " +
            "Not allowed when the target status is ACTIVE.",
    })
    moveProductsTo?: string;

    @ApiPropertyOptional({
        type: Boolean,
        default: false,
        description:
            "Only when leaving ACTIVE. Child categories NOT included in the change get their parent removed " +
            "(they become root categories, their subtree depth is shifted). Without it, such children block the change.",
    })
    detachChildren?: boolean;
}

export class CategoryBulkStatusBodyDoc extends CategoryStatusBodyDoc {
    @ApiProperty({
        type: [String],
        example: ["12", "15"],
        minItems: 1,
        maxItems: CATEGORY_BULK_MAX,
        description: `Category IDs (1–${CATEGORY_BULK_MAX}, duplicates ignored).`,
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

export class CategoryParentRefResponse {
    @ApiProperty({ ...BIGINT_ID, example: "3" })
    id!: string;

    @ApiProperty({ example: "fashion" })
    slug!: string;

    @ApiProperty({ ...LOCALE_MAP, example: { en: "Fashion", ar: "أزياء" } })
    name!: Record<string, string>;
}

export class CategoryListItemResponse {
    @ApiProperty({ ...BIGINT_ID, example: "12" })
    id!: string;

    @ApiProperty({ example: "shoes" })
    slug!: string;

    @ApiProperty({ ...LOCALE_MAP, example: { en: "Shoes", ar: "أحذية" } })
    name!: Record<string, string>;

    @ApiProperty({
        ...LOCALE_MAP,
        nullable: true,
        example: { en: "All kinds of shoes for men, women and kids…" },
        description:
            "Plain-text description (HTML stripped), max 160 chars per language",
    })
    shortDescription!: Record<string, string> | null;

    @ApiProperty({ ...BIGINT_ID, nullable: true, example: "3" })
    parentId!: string | null;

    @ApiProperty({ example: 1, description: "0 for root categories" })
    depth!: number;

    @ApiProperty({ example: 0 })
    position!: number;

    @ApiProperty({ enum: CategoryStatus, example: CategoryStatus.ACTIVE })
    status!: CategoryStatus;

    @ApiProperty({ ...BIGINT_ID, nullable: true, example: "45" })
    iconId!: string | null;

    @ApiProperty({
        type: String,
        nullable: true,
        example: ICON_URL_EXAMPLE,
        description: "Thumbnail variant URL",
    })
    iconUrl!: string | null;

    @ApiProperty({ ...BIGINT_ID, nullable: true, example: "46" })
    bannerId!: string | null;

    @ApiProperty({
        type: String,
        nullable: true,
        example: BANNER_THUMB_URL_EXAMPLE,
        description: "Banner thumbnail variant URL",
    })
    bannerUrl!: string | null;

    @ApiProperty({
        example: 37,
        description: "Products in this category (excludes soft-deleted)",
    })
    productCount!: number;
}

export class CategoryListResponse {
    @ApiProperty({ type: () => [CategoryListItemResponse] })
    items!: CategoryListItemResponse[];

    @ApiProperty({ example: 2 })
    total!: number;

    @ApiProperty({ example: 1 })
    page!: number;

    @ApiProperty({ example: 20 })
    limit!: number;
}

export class CategoryDetailResponse {
    @ApiProperty({ ...BIGINT_ID, example: "12" })
    id!: string;

    @ApiProperty({ example: "shoes" })
    slug!: string;

    @ApiProperty({ ...LOCALE_MAP, example: { en: "Shoes", ar: "أحذية" } })
    name!: Record<string, string>;

    @ApiProperty({
        ...LOCALE_MAP,
        nullable: true,
        example: { en: "<p>All kinds of shoes</p>" },
    })
    description!: Record<string, string> | null;

    @ApiProperty({ ...BIGINT_ID, nullable: true, example: "3" })
    parentId!: string | null;

    @ApiProperty({ type: () => CategoryParentRefResponse, nullable: true })
    parent!: CategoryParentRefResponse | null;

    @ApiProperty({ example: 1 })
    depth!: number;

    @ApiProperty({ example: 0 })
    position!: number;

    @ApiProperty({ enum: CategoryStatus, example: CategoryStatus.ACTIVE })
    status!: CategoryStatus;

    @ApiProperty({ ...BIGINT_ID, nullable: true, example: "45" })
    iconId!: string | null;

    @ApiProperty({
        type: String,
        nullable: true,
        example: ICON_URL_EXAMPLE,
        description: "Thumbnail variant URL",
    })
    iconUrl!: string | null;

    @ApiProperty({ ...BIGINT_ID, nullable: true, example: "46" })
    bannerId!: string | null;

    @ApiProperty({
        type: String,
        nullable: true,
        example: BANNER_URL_EXAMPLE,
        description: "Master variant URL",
    })
    bannerUrl!: string | null;

    @ApiProperty({ example: 4, description: "Number of direct children" })
    childCount!: number;

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

/** Raw category row returned by create / update. */
export class CategoryRecordResponse {
    @ApiProperty({ ...BIGINT_ID, example: "12" })
    id!: string;

    @ApiProperty({ example: "running-shoes" })
    slug!: string;

    @ApiProperty({
        ...LOCALE_MAP,
        example: { en: "Running Shoes", ar: "أحذية الجري" },
    })
    name!: Record<string, string>;

    @ApiProperty({
        ...LOCALE_MAP,
        nullable: true,
        example: { en: "<p>Shoes built for running</p>" },
    })
    description!: Record<string, string> | null;

    @ApiProperty({ ...BIGINT_ID, nullable: true, example: "3" })
    parentId!: string | null;

    @ApiProperty({ ...BIGINT_ID, example: "45" })
    iconId!: string;

    @ApiProperty({ ...BIGINT_ID, nullable: true, example: "46" })
    bannerId!: string | null;

    @ApiProperty({ example: 1 })
    depth!: number;

    @ApiProperty({ example: 0 })
    position!: number;

    @ApiProperty({ enum: CategoryStatus, example: CategoryStatus.ACTIVE })
    status!: CategoryStatus;

    @ApiProperty({
        type: String,
        format: "date-time",
        example: "2026-10-18T08:30:00.000Z",
    })
    createdAt!: string;

    @ApiProperty({
        type: String,
        format: "date-time",
        example: "2026-10-18T08:30:00.000Z",
    })
    updatedAt!: string;
}

/** Storefront tree node, already localized to the request language. */
export class CategoryTreeNodeResponse {
    @ApiProperty({ ...BIGINT_ID, example: "3" })
    id!: string;

    @ApiProperty({ example: "fashion" })
    slug!: string;

    @ApiProperty({ type: String, nullable: true, example: "Fashion" })
    name!: string | null;

    @ApiProperty({
        type: String,
        nullable: true,
        example: "<p>Clothing and accessories</p>",
    })
    description!: string | null;

    @ApiProperty({ type: String, nullable: true, example: ICON_URL_EXAMPLE })
    iconUrl!: string | null;

    @ApiProperty({ type: String, nullable: true, example: BANNER_URL_EXAMPLE })
    bannerUrl!: string | null;

    @ApiProperty({
        type: () => [CategoryTreeNodeResponse],
        description: "Nested ACTIVE child categories (same shape, recursive)",
    })
    children!: CategoryTreeNodeResponse[];
}

export class CheckCategorySlugResponse {
    @ApiProperty({
        example: true,
        description: "Whether the slug is already taken",
    })
    exists!: boolean;

    @ApiProperty({
        example: "fresh-fruits",
        description: "Normalized slug that was checked",
    })
    slug!: string;

    @ApiProperty({
        type: String,
        nullable: true,
        example: "fresh-fruits-2",
        description: "Next free slug when taken, otherwise null. Not reserved.",
    })
    suggestion!: string | null;
}

export class CategoryStatusResponse {
    @ApiProperty({ example: true })
    success!: boolean;

    @ApiProperty({ ...BIGINT_ID, example: "12" })
    id!: string;

    @ApiProperty({ enum: CategoryStatus, example: CategoryStatus.INACTIVE })
    status!: CategoryStatus;

    @ApiProperty({ ...BIGINT_ID, nullable: true, example: "7" })
    moveProductsTo!: string | null;

    @ApiProperty({
        example: 37,
        description: "Products reassigned to `moveProductsTo`",
    })
    movedProductCount!: number;

    @ApiProperty({
        example: 4,
        description: "Store listings reassigned to `moveProductsTo`",
    })
    movedListingCount!: number;

    @ApiProperty({
        type: [String],
        example: ["21"],
        description: "Children that became root categories",
    })
    detachedChildIds!: string[];
}

export class CategoryStatusBlockerResponse {
    @ApiProperty({
        ...BIGINT_ID,
        nullable: true,
        example: "12",
        description:
            "Blocked category; null for batch-wide rules (minimumRequired)",
    })
    id!: string | null;

    @ApiProperty({
        enum: ["inUse", "hasChildren", "parentNotActive", "minimumRequired"],
        example: "inUse",
        description:
            "inUse → send `moveProductsTo`. hasChildren → include the children or send `detachChildren: true`. " +
            "parentNotActive → include the parent. minimumRequired → keep at least one ACTIVE category.",
    })
    code!: string;

    @ApiProperty({
        example:
            '"Shoes" is used by 37 product(s) and 4 store listing(s). Move them to another category first.',
        description: "Translated message (Accept-Language)",
    })
    message!: string;

    @ApiPropertyOptional({ example: 37 })
    productCount?: number;

    @ApiPropertyOptional({ example: 4 })
    listingCount?: number;

    @ApiPropertyOptional({ type: [String], example: ["21", "22"] })
    childIds?: string[];

    @ApiPropertyOptional({ ...BIGINT_ID, example: "3" })
    parentId?: string;
}

export class CategoryBulkStatusResponse {
    @ApiProperty({ example: true })
    success!: boolean;

    @ApiProperty({
        example: true,
        description: "False only on a dry run that found blockers",
    })
    canApply!: boolean;

    @ApiProperty({ example: false })
    dryRun!: boolean;

    @ApiProperty({ enum: CategoryStatus, example: CategoryStatus.INACTIVE })
    status!: CategoryStatus;

    @ApiProperty({
        type: [String],
        example: ["12", "15"],
        description: "Changed (or would change on a dry run)",
    })
    updatedIds!: string[];

    @ApiProperty({
        type: [String],
        example: ["18"],
        description: "Already in the target status",
    })
    unchangedIds!: string[];

    @ApiProperty({ ...BIGINT_ID, nullable: true, example: "7" })
    moveProductsTo!: string | null;

    @ApiProperty({ example: 37 })
    movedProductCount!: number;

    @ApiProperty({ example: 4 })
    movedListingCount!: number;

    @ApiProperty({ type: [String], example: ["21"] })
    detachedChildIds!: string[];

    @ApiProperty({
        type: () => [CategoryStatusBlockerResponse],
        description: "Empty unless dry run",
    })
    blockers!: CategoryStatusBlockerResponse[];
}

export class CategoryDeleteResponse {
    @ApiProperty({ example: true })
    success!: boolean;

    @ApiProperty({ ...BIGINT_ID, example: "12" })
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
                items: { $ref: getSchemaPath(CategoryStatusBlockerResponse) },
            },
        },
    };
}

// =====================================================================
// Controller-level decorators
// =====================================================================

/** Storefront controller: public, no auth header. */
export function ApiStorefrontCategoriesController() {
    return applyDecorators(
        ApiTags("StorefrontCategories"),
        ACCEPT_LANGUAGE_HEADER,
    );
}

/** Admin controller: bearer auth + common 401 / 403 responses. */
export function ApiAdminCategoriesController() {
    return applyDecorators(
        ApiTags("AdminCategories"),
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

/** GET /public/catalog/categories */
export function ApiCategoryTree() {
    return applyDecorators(
        ApiOperation({
            summary: "Get the active category tree",
            description:
                "Public. Returns only ACTIVE categories as a nested tree, localized to `Accept-Language`. " +
                "An ACTIVE child whose parent is not ACTIVE is promoted to a root. " +
                "Siblings are ordered by `position`. `description` is sanitized HTML. Cached server-side.",
        }),
        ApiOkResponse({
            description: "Root nodes with nested `children`",
            type: CategoryTreeNodeResponse,
            isArray: true,
            example: [
                {
                    id: "3",
                    slug: "fashion",
                    name: "Fashion",
                    description: "<p>Clothing and accessories</p>",
                    iconUrl: ICON_URL_EXAMPLE,
                    bannerUrl: BANNER_URL_EXAMPLE,
                    children: [
                        {
                            id: "12",
                            slug: "shoes",
                            name: "Shoes",
                            description: null,
                            iconUrl: ICON_URL_EXAMPLE,
                            bannerUrl: null,
                            children: [],
                        },
                    ],
                },
            ],
        }),
    );
}

// =====================================================================
// Admin endpoints
// =====================================================================

/** GET /admin/catalog/categories */
export function ApiAdminCategoryList() {
    return applyDecorators(
        ApiOperation({
            summary: "List categories (paginated)",
            description:
                "Requires `CATEGORY_READ`. Flat, paginated list for admin tables and parent pickers. " +
                "Search matches the slug and names in allowed languages. " +
                "Returns a plain-text `shortDescription` (no HTML), product count and icon / banner thumbnails.",
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
            example: "shoe",
            description:
                "Search term (max 100 chars), matches slug or localized name",
        }),
        ApiQuery({ name: "status", required: false, enum: CategoryStatus }),
        ApiQuery({
            name: "excludeSubtreeOf",
            required: false,
            type: [String],
            example: ["3"],
            description:
                "Exclude these categories AND all their descendants (max 20). Useful for the parent picker when editing.",
        }),
        ApiQuery({
            name: "excludeIds",
            required: false,
            type: [String],
            example: ["12", "15"],
            description: "Exclude these exact category IDs (max 100)",
        }),
        ApiQuery({
            name: "sort",
            required: false,
            enum: CATEGORY_SORTS,
            example: "position_asc",
            description: "Sort order. Ties are broken by `id desc`.",
        }),
        ApiOkResponse({
            description: "Paginated category list",
            type: CategoryListResponse,
            example: {
                items: [
                    {
                        id: "12",
                        slug: "shoes",
                        name: { en: "Shoes", ar: "أحذية" },
                        shortDescription: {
                            en: "All kinds of shoes for men, women and kids…",
                        },
                        parentId: "3",
                        depth: 1,
                        position: 0,
                        status: "ACTIVE",
                        iconId: "45",
                        iconUrl: ICON_URL_EXAMPLE,
                        bannerId: "46",
                        bannerUrl: BANNER_THUMB_URL_EXAMPLE,
                        productCount: 37,
                    },
                    {
                        id: "15",
                        slug: "bags",
                        name: { en: "Bags", ar: "حقائب" },
                        shortDescription: null,
                        parentId: null,
                        depth: 0,
                        position: 1,
                        status: "ACTIVE",
                        iconId: null,
                        iconUrl: null,
                        bannerId: null,
                        bannerUrl: null,
                        productCount: 0,
                    },
                ],
                total: 2,
                page: 1,
                limit: 20,
            },
        }),
        ApiBadRequestResponse({
            description: "Invalid query parameters",
            schema: errorSchema(400, "Bad Request", [
                "sort must be one of the following values: position_asc, position_desc, ...",
            ]),
        }),
    );
}

/** GET /admin/catalog/categories/check-slug */
export function ApiCheckCategorySlug() {
    return applyDecorators(
        ApiOperation({
            summary: "Check slug availability",
            description:
                "Requires `CATEGORY_CREATE` or `CATEGORY_UPDATE`. Send `slug`, or `title` to have a slug generated. " +
                "When taken, suggests the next free `-N` suffix. Reads the database directly (no cache); the suggestion is not reserved.",
        }),
        ApiQuery({
            name: "title",
            required: false,
            type: String,
            example: "Fresh Fruits",
            description:
                "Used to generate a slug when `slug` is not sent (max 200 chars)",
        }),
        ApiQuery({
            name: "slug",
            required: false,
            type: String,
            example: "fresh-fruits",
        }),
        ApiQuery({
            name: "excludeId",
            required: false,
            type: String,
            example: "12",
            description:
                "The category being edited, so its own slug is not reported as taken",
        }),
        ApiOkResponse({
            description: "Availability result",
            type: CheckCategorySlugResponse,
            examples: {
                available: {
                    summary: "Slug is free",
                    value: {
                        exists: false,
                        slug: "fresh-fruits",
                        suggestion: null,
                    },
                },
                taken: {
                    summary: "Slug is taken",
                    value: {
                        exists: true,
                        slug: "fresh-fruits",
                        suggestion: "fresh-fruits-2",
                    },
                },
            },
        }),
        ApiBadRequestResponse({
            description: causes("Nothing usable to check", [
                "Neither `title` nor `slug` sent (`catalog.category.slugInputRequired`)",
                "Input produces an empty slug (`catalog.category.slugInvalid`)",
            ]),
            schema: errorSchema(400, "Bad Request", "Provide a title or slug"),
        }),
    );
}

/** GET /admin/catalog/categories/:id */
export function ApiAdminCategoryGet() {
    return applyDecorators(
        ApiOperation({
            summary: "Get a category for the edit form",
            description:
                "Requires `CATEGORY_READ`. Returns all localized maps, parent reference, media URLs and child count.",
        }),
        ID_PARAM,
        ApiOkResponse({
            description: "Category details",
            type: CategoryDetailResponse,
        }),
        NOT_FOUND,
    );
}

const UPSERT_BAD_REQUEST = (extra: string[] = []) =>
    ApiBadRequestResponse({
        description: causes("Invalid payload", [
            "Body validation failed (missing `name` / `iconId`, bad id format, unknown status, ...)",
            "Default-language name missing in `name`",
            "`iconId` / `bannerId` is not a valid image for the CATEGORY / CATEGORY_BANNER purpose",
            ...extra,
        ]),
        schema: errorSchema(400, "Bad Request", ["iconId must be a valid id"]),
    });

/** POST /admin/catalog/categories */
export function ApiCreateCategory() {
    return applyDecorators(
        ApiOperation({
            summary: "Create a category",
            description:
                "Requires `CATEGORY_CREATE`. `depth` is computed from the parent. " +
                "An ACTIVE category needs an ACTIVE parent. `description` HTML is sanitized. Busts catalog and product caches.",
        }),
        ApiBody({
            type: CategoryUpsertBodyDoc,
            examples: {
                root: {
                    summary: "Root category",
                    value: {
                        name: { en: "Fashion", ar: "أزياء" },
                        description: {
                            en: "<p>Clothing and <strong>accessories</strong></p>",
                        },
                        iconId: "45",
                        bannerId: "46",
                        position: 0,
                    },
                },
                child: {
                    summary: "Child category with explicit slug",
                    value: {
                        parentId: "3",
                        slug: "running-shoes",
                        name: { en: "Running Shoes", ar: "أحذية الجري" },
                        iconId: "47",
                        status: "INACTIVE",
                        position: 2,
                    },
                },
            },
        }),
        ApiCreatedResponse({
            description: "Created category row",
            type: CategoryRecordResponse,
        }),
        UPSERT_BAD_REQUEST(),
        ApiNotFoundResponse({
            description:
                "Parent category not found (`catalog.category.parentNotFound`)",
            schema: errorSchema(404, "Not Found", "Parent category not found"),
        }),
        ApiConflictResponse({
            description: causes("Conflict", [
                "Slug already used (`catalog.category.slugTaken`)",
                "Creating an ACTIVE category under a non-ACTIVE parent (`catalog.category.parentNotActive`)",
            ]),
            schema: errorSchema(409, "Conflict", "Slug is already taken"),
        }),
    );
}

/** PUT /admin/catalog/categories/:id */
export function ApiUpdateCategory() {
    return applyDecorators(
        ApiOperation({
            summary: "Update a category (full replace)",
            description:
                "Requires `CATEGORY_UPDATE`. This is a full replacement: omitted `parentId` moves the category to the root, " +
                "omitted `position` resets to 0 and omitted `description` clears it. Omitted `slug` and `status` keep their current values. " +
                "Moving the category shifts the depth of all descendants. Leaving ACTIVE follows the same guards as the status endpoint " +
                "(without the move / detach options — use the status endpoint for those).",
        }),
        ID_PARAM,
        ApiBody({
            type: CategoryUpsertBodyDoc,
            examples: {
                rename: {
                    summary: "Rename and keep position",
                    value: {
                        parentId: "3",
                        name: { en: "Sneakers", ar: "أحذية رياضية" },
                        iconId: "45",
                        position: 0,
                    },
                },
                move: {
                    summary: "Move under another parent",
                    value: {
                        parentId: "20",
                        name: { en: "Shoes" },
                        iconId: "45",
                        bannerId: "46",
                        position: 1,
                    },
                },
                archive: {
                    summary: "Archive via update",
                    value: {
                        parentId: "3",
                        name: { en: "Shoes" },
                        iconId: "45",
                        status: "ARCHIVED",
                    },
                },
            },
        }),
        ApiOkResponse({
            description: "Updated category row",
            type: CategoryRecordResponse,
        }),
        UPSERT_BAD_REQUEST([
            "Category set as its own parent (`catalog.category.selfParent`)",
            "Parent is one of the category's descendants (`catalog.category.cycle`)",
        ]),
        ApiNotFoundResponse({
            description: causes("Not found", [
                "Category not found (`catalog.category.notFound`)",
                "Parent category not found (`catalog.category.parentNotFound`)",
            ]),
            schema: errorSchema(404, "Not Found", "Category not found"),
        }),
        ApiConflictResponse({
            description: causes("Conflict", [
                "Slug already used (`catalog.category.slugTaken`)",
                "ACTIVE category under a non-ACTIVE parent (`catalog.category.parentNotActive`)",
                "Leaving ACTIVE while products or store listings use it (`catalog.category.inUse`)",
                "Leaving ACTIVE while it has child categories (`catalog.category.hasChildren`)",
                "Leaving ACTIVE as the last ACTIVE category (`catalog.category.minimumRequired`)",
            ]),
            schema: errorSchema(409, "Conflict", "Category is in use"),
        }),
    );
}

const STATUS_RULES =
    "- Leaving ACTIVE (→ INACTIVE / ARCHIVED):\n" +
    "  - Products (incl. soft-deleted) or store listings use it → blocked (`inUse`), unless `moveProductsTo` is sent: " +
    "they are reassigned to that ACTIVE category first.\n" +
    "  - Child categories not part of the change → blocked (`hasChildren`), unless `detachChildren: true`: " +
    "their parent is removed and they become root categories.\n" +
    "  - At least one ACTIVE category must remain (`minimumRequired`).\n" +
    "- Becoming ACTIVE: the parent must be ACTIVE (or part of the same bulk request) (`parentNotActive`). " +
    "`moveProductsTo` is not allowed.\n" +
    "- INACTIVE ↔ ARCHIVED: no checks.\n\n" +
    "Recommended UI flow: try the change (or `dryRun` in bulk) → on `inUse` blockers ask the admin for a target category → " +
    "resend with `moveProductsTo`; on `hasChildren` offer to include the children or resend with `detachChildren: true`.";

const STATUS_BAD_REQUEST = ApiBadRequestResponse({
    description: causes("Invalid request", [
        "Body validation failed (`status` missing / invalid, bad id format, empty or too many `ids`)",
        "`moveProductsTo` sent while activating (`catalog.category.moveTargetNotAllowed`)",
        "`moveProductsTo` is one of the categories being changed (`catalog.category.moveTargetInSelection`)",
    ]),
    schema: errorSchema(400, "Bad Request", [
        "status must be one of the following values: ACTIVE, INACTIVE, ARCHIVED",
    ]),
});

/** PATCH /admin/catalog/categories/:id/status */
export function ApiSetCategoryStatus() {
    return applyDecorators(
        ApiExtraModels(CategoryStatusBlockerResponse),
        ApiOperation({
            summary: "Change category status",
            description: `Requires \`CATEGORY_UPDATE\`. Idempotent. Same rules as the bulk endpoint.\n\n${STATUS_RULES}`,
        }),
        ID_PARAM,
        ApiBody({
            type: CategoryStatusBodyDoc,
            examples: {
                deactivate: {
                    summary: "Hide temporarily",
                    value: { status: "INACTIVE" },
                },
                archive: { summary: "Retire", value: { status: "ARCHIVED" } },
                activate: {
                    summary: "Show again",
                    value: { status: "ACTIVE" },
                },
                moveAndArchive: {
                    summary: "Move products, detach children, then archive",
                    value: {
                        status: "ARCHIVED",
                        moveProductsTo: "7",
                        detachChildren: true,
                    },
                },
            },
        }),
        ApiOkResponse({
            description: "Status applied (or already set)",
            type: CategoryStatusResponse,
        }),
        STATUS_BAD_REQUEST,
        ApiNotFoundResponse({
            description: causes("Not found", [
                "Category not found (`catalog.category.notFound`)",
                "`moveProductsTo` category not found (`catalog.category.moveTargetNotFound`)",
            ]),
            schema: errorSchema(404, "Not Found", "Category not found"),
        }),
        ApiConflictResponse({
            description: causes("Status change not allowed — see `blockers`", [
                "Products or store listings use it (`inUse`)",
                "It has child categories (`hasChildren`)",
                "It is the last ACTIVE category (`minimumRequired`)",
                "Activating under a non-ACTIVE parent (`parentNotActive`)",
                "`moveProductsTo` is not ACTIVE (`catalog.category.moveTargetNotActive`, no `blockers`)",
            ]),
            schema: blockedSchema(
                '"Shoes" is used by 37 product(s) and 4 store listing(s). Move them to another category first.',
            ),
        }),
    );
}

/** PATCH /admin/catalog/categories/bulk/status */
export function ApiBulkSetCategoryStatus() {
    return applyDecorators(
        ApiExtraModels(CategoryStatusBlockerResponse),
        ApiOperation({
            summary: "Change status of many categories",
            description:
                `Requires \`CATEGORY_UPDATE\`. Up to ${CATEGORY_BULK_MAX} ids, one transaction, **all-or-nothing**: ` +
                "if any category is blocked nothing is saved and the 409 lists every blocker. " +
                "Categories already in the target status are returned in `unchangedIds`. " +
                "Children and parents included in the same request never block each other. " +
                "Send `dryRun: true` to get the plan and blockers without saving.\n\n" +
                STATUS_RULES,
        }),
        ApiBody({
            type: CategoryBulkStatusBodyDoc,
            examples: {
                preview: {
                    summary: "Preview (dry run)",
                    value: {
                        ids: ["12", "15"],
                        status: "INACTIVE",
                        dryRun: true,
                    },
                },
                deactivate: {
                    summary: "Deactivate",
                    value: { ids: ["12", "15"], status: "INACTIVE" },
                },
                moveAndArchive: {
                    summary: "Move products, detach children, then archive",
                    value: {
                        ids: ["12", "15"],
                        status: "ARCHIVED",
                        moveProductsTo: "7",
                        detachChildren: true,
                    },
                },
                activate: {
                    summary: "Activate a parent with its children",
                    value: { ids: ["3", "12", "13"], status: "ACTIVE" },
                },
            },
        }),
        ApiOkResponse({
            description: "Applied, or the dry-run plan",
            type: CategoryBulkStatusResponse,
            examples: {
                applied: {
                    summary: "Applied",
                    value: {
                        success: true,
                        canApply: true,
                        dryRun: false,
                        status: "ARCHIVED",
                        updatedIds: ["12", "15"],
                        unchangedIds: [],
                        moveProductsTo: "7",
                        movedProductCount: 37,
                        movedListingCount: 4,
                        detachedChildIds: ["21"],
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
                        updatedIds: ["12", "15"],
                        unchangedIds: [],
                        moveProductsTo: null,
                        movedProductCount: 0,
                        movedListingCount: 0,
                        detachedChildIds: [],
                        blockers: [
                            {
                                id: "12",
                                code: "inUse",
                                message:
                                    '"Shoes" is used by 37 product(s) and 4 store listing(s). Move them to another category first.',
                                productCount: 37,
                                listingCount: 4,
                            },
                            {
                                id: "15",
                                code: "hasChildren",
                                message:
                                    '"Bags" has 1 child category(ies) not included in this change. Include them or detach them.',
                                childIds: ["21"],
                            },
                        ],
                    },
                },
            },
        }),
        STATUS_BAD_REQUEST,
        ApiNotFoundResponse({
            description: causes("Not found", [
                "Some ids do not exist (`catalog.category.bulkNotFound`, lists the ids)",
                "`moveProductsTo` category not found (`catalog.category.moveTargetNotFound`)",
            ]),
            schema: errorSchema(
                404,
                "Not Found",
                "Categories not found: 99, 100",
            ),
        }),
        ApiConflictResponse({
            description: causes("Nothing saved — see `blockers`", [
                "Products or store listings use a category (`inUse`)",
                "A category has children outside the request (`hasChildren`)",
                "No ACTIVE category would remain (`minimumRequired`)",
                "Activating under a non-ACTIVE parent outside the request (`parentNotActive`)",
                "`moveProductsTo` is not ACTIVE (`catalog.category.moveTargetNotActive`, no `blockers`)",
            ]),
            schema: blockedSchema("2 categories cannot change status"),
        }),
    );
}

/** DELETE /admin/catalog/categories/:id */
export function ApiDeleteCategory() {
    return applyDecorators(
        ApiOperation({
            summary: "Delete a category permanently",
            description:
                "Requires `CATEGORY_DELETE`. Only allowed when nothing references the category. " +
                "Icon and banner stay in the media library. Prefer ARCHIVED status to retire a category you may restore.",
        }),
        ID_PARAM,
        ApiOkResponse({ description: "Deleted", type: CategoryDeleteResponse }),
        NOT_FOUND,
        ApiConflictResponse({
            description: causes("Category still in use", [
                "Products (including soft-deleted) or store listings use it (`catalog.category.inUse`)",
                "It has child categories (`catalog.category.hasChildren`)",
                "It is the last ACTIVE category (`catalog.category.minimumRequired`)",
                "Any other foreign key still points at it (`catalog.category.inUse`)",
            ]),
            schema: errorSchema(409, "Conflict", "Category is in use"),
        }),
    );
}
