/** Swagger docs (with samples) of category groups: /admin/catalog/category-groups and /public/catalog/category-groups. */
import { causes, errorSchema, IdParam } from "@common/swagger/swagger.util";
import { applyDecorators } from "@nestjs/common";
import {
    ApiBadRequestResponse,
    ApiConflictResponse,
    ApiNotFoundResponse,
    ApiOkResponse,
    ApiOperation,
} from "@nestjs/swagger";

const CATEGORY = (id: string, slug: string, en: string) => ({
    id,
    slug,
    name: { en },
    status: "ACTIVE",
    depth: 0,
    iconUrl: `https://cdn.example.com/category/${slug}-thumb.webp`,
});

const GROUP = {
    id: "3",
    slug: "vegetables-fruits",
    name: { en: "Vegetables & Fruits", bn: "সবজি ও ফল" },
    description: { en: "Fresh produce, delivered daily" },
    status: "ACTIVE",
    position: 0,
    createdAt: "2026-10-26T10:00:00.000Z",
    updatedAt: "2026-10-26T10:00:00.000Z",
    categories: [
        CATEGORY("21", "fresh-vegetables", "Fresh Vegetables"),
        CATEGORY("22", "fresh-fruits", "Fresh Fruits"),
        CATEGORY("35", "exotics", "Exotics"),
    ],
};

const NOT_FOUND = ApiNotFoundResponse({
    description: "Group not found (CATEGORY_GROUP_NOT_FOUND)",
    schema: errorSchema(404, "Not Found", "Category group not found", "CATEGORY_GROUP_NOT_FOUND"),
});

const BAD_UPSERT = ApiBadRequestResponse({
    description: causes("Invalid", [
        "Validation (name map, slug format, ids)",
        "A category id doesn't exist (CATEGORY_NOT_FOUND, with `missing` ids)",
        "More than 200 categories (TOO_MANY_CATEGORIES)",
    ]),
    schema: {
        example: {
            statusCode: 400,
            error: "Bad Request",
            code: "CATEGORY_NOT_FOUND",
            message: "One or more categories don't exist",
            missing: ["999"],
        },
    },
});

const ID = IdParam("id", "Category group ID", "3");

/** GET /admin/catalog/category-groups */
export const ApiCategoryGroupList = () =>
    applyDecorators(
        ApiOperation({
            summary: "List category groups",
            description:
                "Requires `category.read`. Ordered by `position`. Filters: `q` (slug / name), `status`, `categoryId` (groups containing that category).",
        }),
        ApiOkResponse({
            schema: {
                example: {
                    items: [
                        {
                            id: "3",
                            slug: "vegetables-fruits",
                            name: GROUP.name,
                            status: "ACTIVE",
                            position: 0,
                            updatedAt: GROUP.updatedAt,
                            categoryCount: 3,
                        },
                    ],
                    total: 1,
                    page: 1,
                    limit: 20,
                },
            },
        }),
    );

/** GET /admin/catalog/category-groups/:id */
export const ApiCategoryGroupGet = () =>
    applyDecorators(
        ApiOperation({
            summary: "One category group (edit form)",
            description: "Requires `category.read`. `categories` in display order, any status (inactive ones are hidden in the storefront).",
        }),
        ID,
        ApiOkResponse({ schema: { example: GROUP } }),
        NOT_FOUND,
    );

/** POST /admin/catalog/category-groups */
export const ApiCategoryGroupCreate = () =>
    applyDecorators(
        ApiOperation({
            summary: "Create a category group",
            description:
                "Requires `category.create`. Holds categories only (no products); a category may be in several groups. " +
                "`categoryIds` order = display order. Returns the group as `GET :id`.",
        }),
        ApiOkResponse({ description: "Created group", schema: { example: GROUP } }),
        BAD_UPSERT,
        ApiConflictResponse({
            description: "Slug already used (catalog.categoryGroup.slugTaken)",
            schema: errorSchema(409, "Conflict", "This category group slug is already in use"),
        }),
    );

/** PUT /admin/catalog/category-groups/:id */
export const ApiCategoryGroupUpdate = () =>
    applyDecorators(
        ApiOperation({
            summary: "Replace a category group",
            description:
                "Requires `category.update`. Send the whole form: `categoryIds` replaces the list (and its order).",
        }),
        ID,
        ApiOkResponse({ schema: { example: GROUP } }),
        BAD_UPSERT,
        NOT_FOUND,
        ApiConflictResponse({
            description: "Slug already used",
            schema: errorSchema(409, "Conflict", "This category group slug is already in use"),
        }),
    );

/** PATCH /admin/catalog/category-groups/:id/status */
export const ApiCategoryGroupStatus = () =>
    applyDecorators(
        ApiOperation({
            summary: "Show / hide a category group",
            description: "Requires `category.update`. Only ACTIVE groups appear in the storefront.",
        }),
        ID,
        ApiOkResponse({ schema: { example: { ...GROUP, status: "INACTIVE" } } }),
        NOT_FOUND,
    );

/** DELETE /admin/catalog/category-groups/:id */
export const ApiCategoryGroupDelete = () =>
    applyDecorators(
        ApiOperation({
            summary: "Delete a category group",
            description:
                "Requires `category.delete`. Removes the group and its list; categories and products are untouched.",
        }),
        ID,
        ApiOkResponse({ schema: { example: { success: true } } }),
        NOT_FOUND,
    );

const PUBLIC_GROUP = {
    id: "3",
    slug: "vegetables-fruits",
    name: "Vegetables & Fruits",
    description: "Fresh produce, delivered daily",
    categories: [
        { id: "21", slug: "fresh-vegetables", name: "Fresh Vegetables", iconUrl: "https://cdn.example.com/category/fresh-vegetables-thumb.webp" },
        { id: "22", slug: "fresh-fruits", name: "Fresh Fruits", iconUrl: "https://cdn.example.com/category/fresh-fruits-thumb.webp" },
    ],
};

/** GET /public/catalog/category-groups */
export const ApiPublicCategoryGroups = () =>
    applyDecorators(
        ApiOperation({
            summary: "Category groups with their categories",
            description:
                "ACTIVE groups by `position`, each with its ACTIVE categories in the group's order, names in `Accept-Language`. " +
                "Groups without an active category are left out. Cached; changes show within seconds.",
        }),
        ApiOkResponse({ schema: { example: [PUBLIC_GROUP] } }),
    );

/** GET /public/catalog/category-groups/:slug */
export const ApiPublicCategoryGroup = () =>
    applyDecorators(
        ApiOperation({ summary: "One category group by slug" }),
        ApiOkResponse({ schema: { example: PUBLIC_GROUP } }),
        NOT_FOUND,
    );
