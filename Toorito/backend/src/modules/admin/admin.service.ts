import {
    P,
    STORE_MANAGER_PERMISSIONS,
    staffPermissions,
} from "@common/authorization/permissions";
import { AuthUser } from "@common/types/auth.type";
import { pageParams } from "@common/utils/helpers.util";
import { PrismaService } from "@core/database/prisma.service";
import { RedisService } from "@core/redis/redis.service";
import {
    AdminCustomerInput,
    AdminDeliveryPartnerInput,
    DashboardRangeInput,
} from "./admin.types";
import { DeliveryService } from "@modules/delivery/delivery.service";
import { Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma-client/client";
import {
    ApprovalStatus,
    OrderStatus,
    UserRole,
    UserStatus,
} from "@prisma-client/enums";

@Injectable()
export class AdminService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly redis: RedisService,
        private readonly delivery: DeliveryService,
    ) {}

    async dashboardSummary() {
        return this.redis.cachedLease(
            "admin:dashboard:summary",
            30,
            async () => {
                const [
                    orders,
                    revenue,
                    customers,
                    stores,
                    partners,
                    outOfStock,
                    pendingUsers,
                    pendingKyc,
                ] = await Promise.all([
                    this.prisma.order.count(),
                    this.prisma.order.aggregate({
                        _sum: { total: true },
                        where: { status: { not: OrderStatus.CANCELLED } },
                    }),
                    this.prisma.user.count({
                        where: { role: UserRole.CUSTOMER, deletedAt: null },
                    }),
                    this.prisma.store.count(),
                    this.prisma.user.count({
                        where: {
                            role: UserRole.DELIVERY_PARTNER,
                            deletedAt: null,
                        },
                    }),
                    this.prisma.storeProduct.count({
                        where: {
                            isActive: true,
                            availableQty: { lte: 0 },
                        },
                    }),
                    this.prisma.user.count({
                        where: {
                            approvalStatus: ApprovalStatus.PENDING,
                            deletedAt: null,
                        },
                    }),
                    this.prisma.kycDocument.count({
                        where: { status: "PENDING" },
                    }),
                ]);

                // Prisma cannot express sellableQty <= lowStockThreshold cleanly,
                // so calculate the exact low-stock count with a parameterized SQL query.
                const lowRows = await this.prisma.$queryRaw<
                    { count: bigint }[]
                >`
                SELECT COUNT(*)::bigint AS count
                FROM "StoreProduct"
                WHERE "isActive" = true
                  AND ("availableQty" - "reservedQty") > 0
                  AND ("availableQty" - "reservedQty") <= "lowStockThreshold"
            `;

                return {
                    orders,
                    revenue: revenue._sum.total ?? 0,
                    customers,
                    stores,
                    partners,
                    lowStock: Number(lowRows[0]?.count ?? 0),
                    outOfStock,
                    pendingApprovals: {
                        users: pendingUsers,
                        kyc: pendingKyc,
                    },
                };
            },
        );
    }

    async salesSeries(q: DashboardRangeInput) {
        const to = q.to ? new Date(q.to) : new Date();
        const from = q.from
            ? new Date(q.from)
            : new Date(to.getTime() - 30 * 86400000);
        const group = q.group ?? "day";
        const trunc =
            group === "month" ? "month" : group === "week" ? "week" : "day";

        const rows = await this.prisma.$queryRaw<
            { bucket: Date; orders: bigint; revenue: any }[]
        >(Prisma.sql`
            SELECT date_trunc(${trunc}, "placedAt") AS bucket,
                   COUNT(*)::bigint AS orders,
                   COALESCE(SUM("total"), 0) AS revenue
            FROM "Order"
            WHERE "placedAt" >= ${from}
              AND "placedAt" <= ${to}
              AND "status" <> 'CANCELLED'
            GROUP BY 1
            ORDER BY 1 ASC
        `);

        return {
            from,
            to,
            group,
            items: rows.map((x) => ({
                date: x.bucket,
                orders: Number(x.orders),
                revenue: x.revenue,
            })),
        };
    }

    async recentActivity(pageQuery: { page?: number; limit?: number }) {
        const { page, limit, skip, take } = pageParams(pageQuery);
        const [items, total] = await Promise.all([
            this.prisma.auditLog.findMany({
                skip,
                take,
                orderBy: { id: "desc" },
            }),
            this.prisma.auditLog.count(),
        ]);
        return { items, total, page, limit };
    }

    async customers(q: AdminCustomerInput) {
        const { page, limit, skip, take } = pageParams(q);
        const where = {
            role: UserRole.CUSTOMER,
            deletedAt: null,
            ...(q.q
                ? {
                      OR: [
                          {
                              name: {
                                  contains: q.q,
                                  mode: "insensitive" as const,
                              },
                          },
                          {
                              phone: {
                                  contains: q.q,
                                  mode: "insensitive" as const,
                              },
                          },
                          {
                              email: {
                                  contains: q.q,
                                  mode: "insensitive" as const,
                              },
                          },
                      ],
                  }
                : {}),
        };
        const [items, total] = await Promise.all([
            this.prisma.user.findMany({
                where,
                skip,
                take,
                orderBy: { id: "desc" },
                select: {
                    id: true,
                    phone: true,
                    name: true,
                    email: true,
                    language: true,
                    status: true,
                    createdAt: true,
                    lastLoginAt: true,
                    _count: { select: { orders: true } },
                },
            }),
            this.prisma.user.count({ where }),
        ]);
        return { items, total, page, limit };
    }

    async customer(id: bigint) {
        const user = await this.prisma.user.findFirst({
            where: { id, role: UserRole.CUSTOMER, deletedAt: null },
            include: {
                addresses: true,
                _count: { select: { orders: true, tickets: true } },
            },
        });
        if (!user) throw new NotFoundException("Customer not found");
        return user;
    }

    async customerOrders(id: bigint, q: { page?: number; limit?: number }) {
        const { page, limit, skip, take } = pageParams(q);
        const where = { userId: id };
        const [items, total] = await Promise.all([
            this.prisma.order.findMany({
                where,
                skip,
                take,
                orderBy: { id: "desc" },
                select: {
                    id: true,
                    orderNumber: true,
                    status: true,
                    paymentStatus: true,
                    total: true,
                    placedAt: true,
                    storeId: true,
                    deliveryPartnerId: true,
                },
            }),
            this.prisma.order.count({ where }),
        ]);
        return { items, total, page, limit };
    }

    async deliveryPartners(q: AdminDeliveryPartnerInput) {
        const { page, limit, skip, take } = pageParams(q);
        const where = {
            role: UserRole.DELIVERY_PARTNER,
            deletedAt: null,
            ...(q.status ? { status: q.status } : {}),
            ...(q.q
                ? {
                      OR: [
                          {
                              name: {
                                  contains: q.q,
                                  mode: "insensitive" as const,
                              },
                          },
                          {
                              phone: {
                                  contains: q.q,
                                  mode: "insensitive" as const,
                              },
                          },
                      ],
                  }
                : {}),
            ...(q.kycStatus
                ? { partnerProfile: { kycStatus: q.kycStatus } }
                : {}),
        };
        const [items, total] = await Promise.all([
            this.prisma.user.findMany({
                where,
                skip,
                take,
                orderBy: { id: "desc" },
                select: {
                    id: true,
                    name: true,
                    phone: true,
                    storeId: true,
                    status: true,
                    approvalStatus: true,
                    createdAt: true,
                    partnerProfile: true,
                },
            }),
            this.prisma.user.count({ where }),
        ]);
        return { items, total, page, limit };
    }

    async deliveryLive() {
        const items = await this.prisma.user.findMany({
            where: {
                role: UserRole.DELIVERY_PARTNER,
                deletedAt: null,
                partnerProfile: {
                    isOnline: true,
                    lastLatitude: { not: null },
                    lastLongitude: { not: null },
                },
            },
            select: {
                id: true,
                name: true,
                phone: true,
                storeId: true,
                partnerProfile: true,
            },
            orderBy: { id: "desc" },
        });
        return { items, total: items.length, page: 1, limit: items.length };
    }

    async partnerOrders(id: bigint, q: { page?: number; limit?: number }) {
        const { page, limit, skip, take } = pageParams(q);
        const where = { deliveryPartnerId: id };
        const [items, total] = await Promise.all([
            this.prisma.order.findMany({
                where,
                skip,
                take,
                orderBy: { id: "desc" },
                select: {
                    id: true,
                    orderNumber: true,
                    status: true,
                    total: true,
                    placedAt: true,
                    storeId: true,
                    customerName: true,
                    customerPhone: true,
                },
            }),
            this.prisma.order.count({ where }),
        ]);
        return { items, total, page, limit };
    }

    async setPartnerStatus(id: bigint, status: UserStatus, reason?: string) {
        const partner = await this.prisma.user.findFirst({
            where: { id, role: UserRole.DELIVERY_PARTNER, deletedAt: null },
            select: { id: true, role: true, storeId: true },
        });
        if (!partner) throw new NotFoundException("Delivery partner not found");
        const updated = await this.prisma.user.update({
            where: { id },
            data: { status, statusReason: reason },
        });
        await this.redis.del(
            `u:ok:${id}:${partner.role}:${partner.storeId ?? 0}`,
        );
        return updated;
    }

    effectivePermissions(user: AuthUser, accessRole?: any, staffDuties: string[] = []) {
        if (user.role === UserRole.SUPER_ADMIN) return Object.values(P);
        if (user.role === UserRole.ADMIN) {
            return Array.isArray(accessRole?.permissions)
                ? accessRole.permissions
                : [];
        }
        if (user.role === UserRole.STORE_MANAGER) {
            return STORE_MANAGER_PERMISSIONS;
        }
        if (user.role === UserRole.STORE_STAFF) {
            return staffPermissions(staffDuties);
        }
        return [];
    }
}
