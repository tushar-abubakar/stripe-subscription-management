import { PageQueryDto } from "@common/dto/page-query.dto";
import { CategoryStatus } from "@prisma-client/enums";

/** Plain input types of the category services (no decorators; the HTTP DTOs in src/api implement them). */


export const CATEGORY_SORTS = [
    "position_asc",
    "position_desc",
    "id_asc",
    "id_desc",
    "slug_asc",
    "slug_desc",
    "depth_asc",
    "depth_desc",
    "updated_asc",
    "updated_desc",
] as const;

export type CategorySort = (typeof CATEGORY_SORTS)[number];

/** Create / update payload for a category (admin). Ids are bigint. */
export interface CategoryInput {
    parentId?: bigint;
    slug?: string;
    name: Record<string, string>;
    description?: Record<string, string>;
    status?: CategoryStatus;
    iconId: bigint;
    bannerId?: bigint;
    position?: number;
}

/**
 * Status change for one category.
 *
 * `moveProductsTo` / `detachChildren` only apply when leaving ACTIVE:
 *  - moveProductsTo: reassign products + store listings to this ACTIVE
 *    category first, instead of failing with "in use".
 *  - detachChildren: child categories not part of the change are turned
 *    into root categories (parentId removed) instead of blocking.
 */
export interface CategoryStatusInput {
    status: CategoryStatus;
    moveProductsTo?: bigint;
    detachChildren?: boolean;
}

/** Bulk status change. All-or-nothing; `dryRun` previews blockers without saving. */
export interface CategoryBulkStatusInput extends CategoryStatusInput {
    ids: bigint[];
    dryRun?: boolean;
}

/** Admin category list filters. */
export interface CategoryListInput extends PageQueryDto {
    q?: string;
    status?: CategoryStatus;
    excludeSubtreeOf?: bigint[];
    excludeIds?: bigint[];
    sort?: CategorySort;
    /** Only categories directly in any of these category groups. */
    groupIds?: bigint[];
}

export interface CheckCategorySlugInput {
    title?: string;
    slug?: string;
    excludeId?: bigint;
}
