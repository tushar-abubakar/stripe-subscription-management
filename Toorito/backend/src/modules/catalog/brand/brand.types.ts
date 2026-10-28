import { PageQueryDto } from "@common/dto/page-query.dto";
import { BrandStatus } from "@prisma-client/enums";

/** Plain input types of the brand services (no decorators; the HTTP DTOs in src/api implement them). */


export const BRAND_SORTS = [
    "id_desc",
    "id_asc",
    "slug_asc",
    "slug_desc",
    "updated_asc",
    "updated_desc",
] as const;

export type BrandSort = (typeof BRAND_SORTS)[number];

/** Create / replace a brand (PUT semantics, same as categories). */
export interface BrandInput {
    slug?: string;
    name: Record<string, string>;
    description?: Record<string, string>;
    status?: BrandStatus;
    logoId: bigint;
    bannerId?: bigint;
}

/**
 * Status change for one brand.
 *
 * `detachProducts` only applies when leaving ACTIVE: products using the
 * brand get their brand removed (`brandId = null`) instead of failing
 * with "in use".
 */
export interface BrandStatusInput {
    status: BrandStatus;
    detachProducts?: boolean;
}

/** Bulk status change. All-or-nothing; `dryRun` previews blockers without saving. */
export interface BrandBulkStatusInput extends BrandStatusInput {
    ids: bigint[];
    dryRun?: boolean;
}

export interface BrandListInput extends PageQueryDto {
    q?: string;
    status?: BrandStatus;
    excludeIds?: bigint[];
    sort?: BrandSort;
}

export interface CheckBrandSlugInput {
    title?: string;
    slug?: string;
    excludeId?: bigint;
}
