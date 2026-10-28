import { PageQueryDto } from "@common/dto/page-query.dto";
import { KycDocType, KycStatus, UserRole } from "@prisma-client/enums";

/** Plain input types of the kyc services (no decorators; the HTTP DTOs in src/api implement them). */


/**
 * One KYC document (files uploaded first through /account/media with purpose=KYC).
 * It is saved as a DRAFT: preview / replace / delete freely, then submit.
 */
export interface KycDocInput {
    type: KycDocType;
    title?: string;
    documentNumber?: string;
    frontMediaId: number;
    backMediaId?: number;
    expiresAt?: string;
}

export interface KycListInput extends PageQueryDto {
    status?: KycStatus;
    role?: UserRole;
    userId?: number;
}

export interface AdminKycListInput extends KycListInput {
    storeId?: number;
}
