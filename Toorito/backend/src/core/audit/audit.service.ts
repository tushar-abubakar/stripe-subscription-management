import { pageParams } from "@common/utils/helpers.util";
import {
    AuditLogListInput,
    AuthLogListInput,
    StockMovementListInput,
    TransactionLogListInput,
} from "./audit.types";
import { PrismaService } from "@core/database/prisma.service";
import { Global, Injectable, Module } from "@nestjs/common";
import { AuthEvent, UserRole } from "@prisma-client/enums";

@Injectable()
export class AuditService {
    constructor(private prisma: PrismaService) {}

    /** Fire-and-forget: logging must never break a request. */
    log(p: {
        actorId?: bigint;
        actorRole?: UserRole;
        storeId?: bigint | null;
        action: string;
        entityType: string;
        entityId?: string | bigint;
        before?: any;
        after?: any;
        ip?: string;
    }) {
        const j = (v: any) =>
            v === undefined
                ? undefined
                : JSON.parse(
                      JSON.stringify(v, (_, x) =>
                          typeof x === "bigint" ? x.toString() : x,
                      ),
                  );
        this.prisma.auditLog
            .create({
                data: {
                    actorId: p.actorId,
                    actorRole: p.actorRole,
                    storeId: p.storeId ?? undefined,
                    action: p.action,
                    entityType: p.entityType,
                    entityId: p.entityId?.toString(),
                    before: j(p.before),
                    after: j(p.after),
                    ipAddress: p.ip,
                },
            })
            .catch(() => undefined);
    }
    auth(p: {
        phone: string;
        role?: UserRole;
        userId?: bigint;
        event: AuthEvent;
        success: boolean;
        reason?: string;
        ip?: string;
        deviceId?: string;
        ua?: string;
    }) {
        this.prisma.authLog
            .create({
                data: {
                    phone: p.phone,
                    role: p.role,
                    userId: p.userId,
                    event: p.event,
                    success: p.success,
                    reason: p.reason,
                    ipAddress: p.ip,
                    deviceId: p.deviceId,
                    userAgent: p.ua?.slice(0, 255),
                },
            })
            .catch(() => undefined);
    }

    // ---------------------------------------------------------------------
    // Log readers (admin)
    // ---------------------------------------------------------------------

    /** Audit trail of admin / store actions, newest first. */
    async listAuditLogs(query: AuditLogListInput) {
        const { take, skip, page, limit } = pageParams(query);
        const where = {
            entityType: query.entityType,
            actorId: query.actorId ? BigInt(query.actorId) : undefined,
            storeId: query.storeId ? BigInt(query.storeId) : undefined,
            ...(query.from || query.to
                ? {
                      createdAt: {
                          ...(query.from ? { gte: new Date(query.from) } : {}),
                          ...(query.to ? { lte: new Date(query.to) } : {}),
                      },
                  }
                : {}),
            ...(query.q
                ? {
                      OR: [
                          {
                              action: {
                                  contains: query.q,
                                  mode: "insensitive" as const,
                              },
                          },
                          {
                              entityType: {
                                  contains: query.q,
                                  mode: "insensitive" as const,
                              },
                          },
                          {
                              entityId: {
                                  contains: query.q,
                                  mode: "insensitive" as const,
                              },
                          },
                      ],
                  }
                : {}),
        };
        const [items, total] = await Promise.all([
            this.prisma.auditLog.findMany({
                where,
                orderBy: { id: "desc" },
                take,
                skip,
            }),
            this.prisma.auditLog.count({ where }),
        ]);
        return { items, total, page, limit };
    }

    /** Login / OTP events, newest first. */
    async listAuthLogs(query: AuthLogListInput) {
        const { take, skip, page, limit } = pageParams(query);
        const where = { phone: query.phone, event: query.event };
        const [items, total] = await Promise.all([
            this.prisma.authLog.findMany({
                where,
                orderBy: { id: "desc" },
                take,
                skip,
            }),
            this.prisma.authLog.count({ where }),
        ]);

        return { items, total, page, limit };
    }

    /** Stock ledger across stores, newest first. */
    async listStockMovements(query: StockMovementListInput) {
        const { take, skip, page, limit } = pageParams(query);
        const where = {
            storeId: query.storeId ? BigInt(query.storeId) : undefined,
            type: query.type,
        };
        const [items, total] = await Promise.all([
            this.prisma.stockMovement.findMany({
                where,
                orderBy: { id: "desc" },
                take,
                skip,
            }),
            this.prisma.stockMovement.count({ where }),
        ]);

        return { items, total, page, limit };
    }

    /** Payment transactions, newest first. */
    async listTransactions(query: TransactionLogListInput) {
        const { take, skip, page, limit } = pageParams(query);
        const where = {
            orderId: query.orderId ? BigInt(query.orderId) : undefined,
            status: query.status,
        };
        const [items, total] = await Promise.all([
            this.prisma.transaction.findMany({
                where,
                orderBy: { id: "desc" },
                take,
                skip,
            }),
            this.prisma.transaction.count({ where }),
        ]);

        return { items, total, page, limit };
    }
}

@Global()
@Module({
    providers: [AuditService],
    exports: [AuditService],
})
export class AuditModule {}
