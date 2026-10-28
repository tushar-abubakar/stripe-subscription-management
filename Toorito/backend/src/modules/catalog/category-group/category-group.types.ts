import { PageQueryDto } from "@common/dto/page-query.dto";
import { CategoryStatus } from "@prisma-client/enums";

/** Plain input types of the category-group service (the HTTP DTOs in src/api implement them). */

/** Most categories one group may hold. */
export const CATEGORY_GROUP_MAX_ITEMS = 200;

/** Create / replace payload of a category group. */
export interface CategoryGroupInput {
    /** Text per language. */
    name: Record<string, string>;
    /** Derived from the default-language name on create when omitted. */
    slug?: string;
    description?: Record<string, string> | null;
    status?: CategoryStatus;
    /** Sort order among groups (lower first). */
    position?: number;
    /** Categories in display order; the whole list is replaced on update. */
    categoryIds: bigint[];
}

export interface CategoryGroupListInput extends PageQueryDto {
    /** Slug or name (any language). */
    q?: string;
    status?: CategoryStatus;
    /** Only groups that contain this category. */
    categoryId?: bigint;
}
