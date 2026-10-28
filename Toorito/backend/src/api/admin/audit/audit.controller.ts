import { P } from "@common/authorization/permissions";
import { Permissions } from "@common/decorators/auth.decorator";
import { ListResponseDto } from "@common/dto/list-response.dto";
import {
    AuditLogQuery,
    AuthLogQuery,
    StockMovementQuery,
    TransactionLogQuery,
} from "./audit.dto";
import { Get, Query } from "@nestjs/common";
import { ApiOkResponse } from "@nestjs/swagger";
import { AdminController } from "../admin-controller.decorator";
import { AuditService } from "@core/audit/audit.service";

/** Read-only log viewers for administrators. Every filter is validated by its DTO. */
@AdminController("logs", "Audit logs")
export class AdminAuditController {
    constructor(private readonly audit: AuditService) {}

    @Permissions(P.AUDIT_READ)
    @ApiOkResponse({ type: ListResponseDto })
    @Get("audit")
    listAuditLogs(@Query() query: AuditLogQuery) {
        return this.audit.listAuditLogs(query);
    }

    @Permissions(P.AUDIT_READ)
    @ApiOkResponse({ type: ListResponseDto })
    @Get("auth")
    listAuthLogs(@Query() query: AuthLogQuery) {
        return this.audit.listAuthLogs(query);
    }

    @Permissions(P.AUDIT_READ)
    @ApiOkResponse({ type: ListResponseDto })
    @Get("stock-movements")
    listStockMovements(@Query() query: StockMovementQuery) {
        return this.audit.listStockMovements(query);
    }

    @Permissions(P.AUDIT_READ)
    @ApiOkResponse({ type: ListResponseDto })
    @Get("transactions")
    listTransactions(@Query() query: TransactionLogQuery) {
        return this.audit.listTransactions(query);
    }
}
