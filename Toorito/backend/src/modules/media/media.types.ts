import { PageQueryDto } from "@common/dto/page-query.dto";
import { MediaGroupBy, MediaUsageType } from "./media.config";
import { MediaPurpose, MediaStatus, MediaType } from "@prisma-client/enums";

/** Plain input types of the media services (no decorators; the HTTP DTOs in src/api implement them). */


/** Filters shared by GET /admin/media and GET /admin/media/summary (or /store/media…). */
export interface MediaFilterInput {
    q?: string;
    purpose?: MediaPurpose;
    status?: MediaStatus;
    type?: MediaType;
    includePrivate?: boolean;
    visibility?: "PUBLIC" | "PRIVATE";
    unused?: boolean;
    usedIn?: MediaUsageType;
    uploadedById?: bigint;
}

export interface MediaListQueryInput extends PageQueryDto, MediaFilterInput {
    sort?: "newest" | "oldest" | "size_desc";
    cursor?: string;
}

export interface MediaSummaryQueryInput extends MediaFilterInput {
    groupBy?: MediaGroupBy;
}
