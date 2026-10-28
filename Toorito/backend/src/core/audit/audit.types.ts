import { PageQueryDto } from "@common/dto/page-query.dto";
import {
    AuthEvent,
    StockMovementType,
    TransactionStatus,
} from "@prisma-client/enums";

/** Plain input types of the audit log readers (the HTTP DTOs in src/api/admin/audit implement them). */

export interface AuditLogListInput extends PageQueryDto {
    entityType?: string;
    actorId?: number;
    storeId?: number;
    /** Matches action, entity type or entity id. */
    q?: string;
    from?: string;
    to?: string;
}

export interface AuthLogListInput extends PageQueryDto {
    phone?: string;
    event?: AuthEvent;
}

export interface StockMovementListInput extends PageQueryDto {
    storeId?: number;
    type?: StockMovementType;
}

export interface TransactionLogListInput extends PageQueryDto {
    orderId?: number;
    status?: TransactionStatus;
}
