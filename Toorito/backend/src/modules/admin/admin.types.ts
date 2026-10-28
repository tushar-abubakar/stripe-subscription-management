import { PageQueryDto } from "@common/dto/page-query.dto";
import { UserStatus } from "@prisma-client/enums";

/** Plain input types of the admin services (no decorators; the HTTP DTOs in src/api implement them). */


export interface AdminCustomerInput extends PageQueryDto {
    q?: string;
}

export interface AdminDeliveryPartnerInput extends PageQueryDto {
    q?: string;
    status?: UserStatus;
    kycStatus?: "PENDING" | "VERIFIED" | "REJECTED";
}

export interface DashboardRangeInput {
    from?: string;
    to?: string;
    group?: "day" | "week" | "month";
}
