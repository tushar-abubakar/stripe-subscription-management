import { MEDIA_ROUTES } from "@modules/media/media.routes";
import { AuthUser } from "@common/types/auth.type";
import { addDays, docNumber, pageParams } from "@common/utils/helpers.util";
import { CurrencyService } from "@core/currency/currency.service";
import { PrismaService } from "@core/database/prisma.service";
import { LocaleService } from "@core/locale/locale.service";
import {
    NotificationsService,
} from "@modules/notifications/notifications.service";
import {
    CreateTicketInput,
    MessageInput,
    MyTicketsInput,
    ResolveTicketInput,
    StaffMessageInput,
    SupportSummaryInput,
    TicketQueueInput,
    UpdateTicketInput,
} from "./support.types";
import {
    MediaPurpose,
    MediaStatus,
    TicketPriority,
} from "@prisma-client/enums";
import {
    BadRequestException,
    ForbiddenException,
    Injectable,
    NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma-client/client";
import { TicketStatus, UserRole } from "@prisma-client/enums";
import { I18nService } from "nestjs-i18n";

const isAdmin = (user: AuthUser) =>
    user.role === UserRole.ADMIN || user.role === UserRole.SUPER_ADMIN;

const OPEN_STATUSES: TicketStatus[] = [
    TicketStatus.OPEN,
    TicketStatus.IN_PROGRESS,
    TicketStatus.WAITING_CUSTOMER,
];

const QUEUE_ORDER: Record<
    NonNullable<TicketQueueInput["sort"]>,
    Prisma.SupportTicketOrderByWithRelationInput[]
> = {
    priority: [{ priority: "desc" }, { lastMessageAt: "desc" }],
    newest: [{ id: "desc" }],
    oldest: [{ id: "asc" }],
    last_message: [{ lastMessageAt: "desc" }],
};

@Injectable()
export class SupportService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly notify: NotificationsService,
        private readonly i18n: I18nService,
        private readonly locale: LocaleService,
        private readonly currency: CurrencyService,
    ) {}

    /** Attachments must be the sender's own SUPPORT uploads (they carry forensic metadata). */
    private async assertAttachments(user: AuthUser, ids?: number[]) {
        if (!ids?.length) return;
        if (new Set(ids).size !== ids.length) throw new BadRequestException(this.i18n.translate("support.errors.attachmentInvalid"));
        const ok = await this.prisma.mediaFile.count({
            where: {
                id: { in: ids.map((i) => BigInt(i)) },
                uploadedById: user.id,
                purpose: MediaPurpose.SUPPORT,
                status: MediaStatus.READY,
                deletedAt: null,
            },
        });
        if (ok !== ids.length)
            throw new BadRequestException({
                message: this.i18n.translate("support.errors.attachmentInvalid"),
                code: "ATTACHMENT_INVALID",
            });
    }

    async create(user: AuthUser, dto: CreateTicketInput) {
        await this.assertAttachments(user, dto.attachmentIds);
        let storeId = user.storeId ?? undefined;

        if (dto.orderId) {
            const order = await this.prisma.order.findFirst({
                where: {
                    id: BigInt(dto.orderId),
                    ...(user.role === UserRole.CUSTOMER
                        ? { userId: user.id }
                        : {}),
                },
                select: {
                    storeId: true,
                },
            });

            if (!order) {
                throw new NotFoundException(
                    this.i18n.translate("support.errors.orderNotFound"),
                );
            }

            storeId = order.storeId;
        }

        return this.prisma.supportTicket.create({
            data: {
                ticketNumber: docNumber("TK"),
                userId: user.id,
                orderId: dto.orderId ? BigInt(dto.orderId) : null,
                storeId,
                category: dto.category,
                subject: dto.subject,
                messages: {
                    create: {
                        senderId: user.id,
                        senderRole: user.role,
                        body: dto.body,
                        attachmentIds:
                            dto.attachmentIds as Prisma.InputJsonValue,
                    },
                },
            },
        });
    }

    mine(user: AuthUser, query: MyTicketsInput) {
        const { take, skip } = pageParams(query);

        return this.prisma.supportTicket.findMany({
            where: {
                userId: user.id,
            },
            orderBy: {
                lastMessageAt: "desc",
            },
            take,
            skip,
        });
    }

    /** Order summaries for a set of tickets (SupportTicket.orderId has no FK relation). */
    private async ordersById(ids: (bigint | null)[]) {
        const unique = [...new Set(ids.filter((id): id is bigint => id != null))];
        if (!unique.length) return new Map<string, never>();

        const orders = await this.prisma.order.findMany({
            where: { id: { in: unique } },
            select: {
                id: true,
                orderNumber: true,
                status: true,
                paymentMethod: true,
                paymentStatus: true,
                total: true,
                placedAt: true,
                deliveredAt: true,
            },
        });

        return new Map(
            orders.map((order) => [
                order.id.toString(),
                { ...order, total: this.currency.format(order.total) },
            ]),
        );
    }

    /** Staff queue: admins see every store (or `storeId`), managers only their own store. */
    async queue(user: AuthUser, query: TicketQueueInput) {
        const { take, skip, page, limit } = pageParams(query);
        const q = query.q?.trim();

        const where: Prisma.SupportTicketWhereInput = {
            ...(isAdmin(user)
                ? query.storeId
                    ? { storeId: BigInt(query.storeId) }
                    : {}
                : { storeId: user.storeId ?? -1n }),
            ...(query.status && { status: query.status }),
            ...(query.priority && { priority: query.priority }),
            ...(query.category && { category: query.category }),
            ...(query.orderId && { orderId: BigInt(query.orderId) }),
            ...(query.assignedToId && {
                assignedToId: BigInt(query.assignedToId),
            }),
            ...(query.unassigned && { assignedToId: null }),
            ...(query.escalated !== undefined && {
                escalatedAt: query.escalated ? { not: null } : null,
            }),
            ...(q && {
                OR: [
                    { ticketNumber: { contains: q, mode: "insensitive" } },
                    { subject: { contains: q, mode: "insensitive" } },
                ],
            }),
            ...((query.from || query.to) && {
                createdAt: {
                    ...(query.from && { gte: new Date(query.from.slice(0, 10)) }),
                    ...(query.to && {
                        lt: addDays(new Date(query.to.slice(0, 10)), 1),
                    }),
                },
            }),
        };

        const [rows, total] = await Promise.all([
            this.prisma.supportTicket.findMany({
                where,
                orderBy: QUEUE_ORDER[query.sort ?? "priority"],
                take,
                skip,
                include: {
                    user: { select: { id: true, name: true, phone: true, role: true } },
                    assignee: { select: { id: true, name: true, role: true } },
                    _count: { select: { messages: true } },
                },
            }),
            this.prisma.supportTicket.count({ where }),
        ]);
        const orders = await this.ordersById(rows.map((r) => r.orderId));

        return {
            items: rows.map((ticket) => ({
                ...ticket,
                order: ticket.orderId
                    ? (orders.get(ticket.orderId.toString()) ?? null)
                    : null,
            })),
            total,
            page,
            limit,
        };
    }

    private async load(user: AuthUser, id: bigint, staff: boolean) {
        const ticket = await this.prisma.supportTicket.findUnique({
            where: { id },
        });

        if (!ticket) {
            throw new NotFoundException(
                this.i18n.translate("support.errors.ticketNotFound"),
            );
        }

        const allowed = staff
            ? isAdmin(user) ||
              ((user.role === UserRole.STORE_MANAGER ||
                  user.role === UserRole.STORE_STAFF) &&
                  ticket.storeId != null &&
                  ticket.storeId === user.storeId)
            : ticket.userId === user.id;

        if (!allowed) {
            throw new ForbiddenException(
                this.i18n.translate("support.errors.accessDenied"),
            );
        }

        return ticket;
    }

    async thread(user: AuthUser, id: bigint, staff: boolean) {
        const ticket = await this.load(user, id, staff);

        const messages = await this.prisma.supportMessage.findMany({
            where: {
                ticketId: id,
                ...(staff ? {} : { isInternal: false }),
            },
            orderBy: {
                id: "asc",
            },
        });

        if (!staff) {
            return { ...ticket, messages };
        }

        // Staff view: who complained, about which order (with its lines), and who handles it.
        const [customer, assignee, order] = await Promise.all([
            this.prisma.user.findUnique({
                where: { id: ticket.userId },
                select: { id: true, name: true, phone: true, role: true, createdAt: true },
            }),
            ticket.assignedToId
                ? this.prisma.user.findUnique({
                      where: { id: ticket.assignedToId },
                      select: { id: true, name: true, role: true },
                  })
                : null,
            ticket.orderId
                ? this.prisma.order.findUnique({
                      where: { id: ticket.orderId },
                      select: {
                          id: true,
                          orderNumber: true,
                          status: true,
                          paymentMethod: true,
                          paymentStatus: true,
                          total: true,
                          placedAt: true,
                          deliveredAt: true,
                          deliveryPartnerId: true,
                          items: {
                              where: { parentId: null },
                              select: {
                                  id: true,
                                  title: true,
                                  variantLabel: true,
                                  sku: true,
                                  quantity: true,
                                  pickedQty: true,
                                  unitPrice: true,
                                  lineTotal: true,
                              },
                          },
                      },
                  })
                : null,
        ]);

        return {
            ...ticket,
            customer,
            assignee,
            attachments: await this.attachments(messages),
            order: order
                ? {
                      ...order,
                      total: this.currency.format(order.total),
                      items: order.items.map((item) => ({
                          ...item,
                          title: this.locale.pick(item.title),
                          unitPrice: this.currency.format(item.unitPrice),
                          lineTotal: this.currency.format(item.lineTotal),
                      })),
                  }
                : null,
            messages,
        };
    }

    /**
     * Staff view of every file in the thread with its forensic metadata
     * (edited / AI-suspected / reused …). The file itself is served by
     * `GET /account/media/{id}/file` to the ticket's store and admins only.
     */
    private async attachments(messages: { attachmentIds: unknown }[]) {
        const ids = [...new Set(messages.flatMap((m) => (Array.isArray(m.attachmentIds) ? (m.attachmentIds as number[]) : [])))];
        if (!ids.length) return [];
        const rows = await this.prisma.mediaFile.findMany({
            where: { id: { in: ids.map((i) => BigInt(i)) } },
            select: { id: true, mimeType: true, sizeBytes: true, width: true, height: true, checksum: true, metadata: true, uploadedById: true, createdAt: true },
        });
        return rows.map((m) => ({ ...m, file: MEDIA_ROUTES.file(m.id) }));
    }

    /** Store → admin team: flags the ticket for the admin queue (`escalated=true`), raises priority to at least HIGH. */
    async escalate(user: AuthUser, id: bigint, note: string) {
        const ticket = await this.load(user, id, true);
        if (ticket.status === TicketStatus.CLOSED)
            throw new ForbiddenException(this.i18n.translate("support.errors.ticketClosed"));
        if (ticket.escalatedAt)
            throw new BadRequestException({ message: this.i18n.translate("support.errors.alreadyEscalated"), code: "ALREADY_ESCALATED" });
        const now = new Date();
        const priority =
            ticket.priority === TicketPriority.URGENT ? TicketPriority.URGENT : TicketPriority.HIGH;
        const [updated] = await this.prisma.$transaction([
            this.prisma.supportTicket.update({
                where: { id },
                data: { escalatedAt: now, escalatedById: user.id, escalationNote: note, priority, lastMessageAt: now },
            }),
            this.prisma.supportMessage.create({
                data: { ticketId: id, senderId: user.id, senderRole: user.role, body: `Escalated to admin: ${note}`, isInternal: true },
            }),
        ]);
        const admins = await this.prisma.user.findMany({
            where: { role: { in: [UserRole.ADMIN, UserRole.SUPER_ADMIN] }, deletedAt: null, status: "ACTIVE" },
            select: { id: true },
            take: 50,
        });
        await Promise.all(
            admins.map((a) =>
                this.notify.notify(a.id, "SUPPORT_ESCALATION", this.i18n.translate("support.notification.escalated") as string, ticket.subject, {
                    ticketId: id.toString(),
                }),
            ),
        );
        return updated;
    }

    async reply(
        user: AuthUser,
        id: bigint,
        dto: MessageInput | StaffMessageInput,
        staff: boolean,
    ) {
        const ticket = await this.load(user, id, staff);
        await this.assertAttachments(user, dto.attachmentIds);

        if (ticket.status === TicketStatus.CLOSED) {
            throw new ForbiddenException(
                this.i18n.translate("support.errors.ticketClosed"),
            );
        }

        const internal = staff && "isInternal" in dto && !!dto.isInternal;
        const now = new Date();

        await this.prisma.$transaction([
            this.prisma.supportMessage.create({
                data: {
                    ticketId: id,
                    senderId: user.id,
                    senderRole: user.role,
                    body: dto.body,
                    attachmentIds: dto.attachmentIds as Prisma.InputJsonValue,
                    isInternal: internal,
                },
            }),

            this.prisma.supportTicket.update({
                where: { id },
                data: {
                    lastMessageAt: now,
                    // Internal notes don't change what the customer is waiting for.
                    ...(!internal && {
                        status: staff
                            ? TicketStatus.WAITING_CUSTOMER
                            : TicketStatus.IN_PROGRESS,
                    }),
                    ...(staff &&
                        !internal &&
                        !ticket.firstResponseAt && { firstResponseAt: now }),
                },
            }),
        ]);

        if (staff && !internal) {
            await this.notifyOwner(
                ticket.userId,
                "support.notification.replied",
                ticket.subject,
                id,
            );
        }

        return {
            success: true,
        };
    }

    /** Notify the ticket owner in their own language, not the agent's. */
    private async notifyOwner(
        userId: bigint,
        key: string,
        body: string,
        ticketId: bigint,
    ) {
        const owner = await this.prisma.user.findUnique({
            where: { id: userId },
            select: { language: true },
        });

        await this.notify.notify(
            userId,
            "SUPPORT",
            this.i18n.translate(key, {
                lang: this.locale.resolve(owner?.language),
            }),
            body,
            { ticketId: ticketId.toString() },
        );
    }

    /**
     * Assignee must be able to work the ticket: a manager / staff of the
     * ticket's store, or (for admins) any admin.
     */
    private async assertAssignee(
        user: AuthUser,
        storeId: bigint | null,
        assigneeId: bigint,
    ) {
        const assignee = await this.prisma.user.findFirst({
            where: { id: assigneeId, deletedAt: null },
            select: { role: true, storeId: true },
        });

        const storeMember =
            !!assignee &&
            (assignee.role === UserRole.STORE_MANAGER ||
                assignee.role === UserRole.STORE_STAFF) &&
            storeId != null &&
            assignee.storeId === storeId;
        const adminMember =
            !!assignee &&
            (assignee.role === UserRole.ADMIN ||
                assignee.role === UserRole.SUPER_ADMIN);

        if (!(storeMember || (isAdmin(user) && adminMember))) {
            throw new BadRequestException({
                message: this.i18n.translate("support.errors.invalidAssignee"),
                code: "INVALID_ASSIGNEE",
            });
        }
    }

    async update(user: AuthUser, id: bigint, dto: UpdateTicketInput) {
        const ticket = await this.load(user, id, true);

        if (dto.assignedToId !== undefined) {
            await this.assertAssignee(user, ticket.storeId, BigInt(dto.assignedToId));
        }

        const closing =
            dto.status === TicketStatus.RESOLVED ||
            dto.status === TicketStatus.CLOSED;

        return this.prisma.supportTicket.update({
            where: { id },
            data: {
                status: dto.status,
                priority: dto.priority,

                assignedToId:
                    dto.assignedToId !== undefined
                        ? BigInt(dto.assignedToId)
                        : undefined,

                ...(closing ? { resolvedAt: new Date() } : {}),
                // Re-opening clears the old resolution timestamp.
                ...(dto.status && !closing ? { resolvedAt: null } : {}),
            },
        });
    }

    /** Resolve (or close) a complaint with a customer-visible resolution note. */
    async resolve(user: AuthUser, id: bigint, dto: ResolveTicketInput) {
        const ticket = await this.load(user, id, true);

        if (ticket.status === TicketStatus.CLOSED) {
            throw new ForbiddenException(
                this.i18n.translate("support.errors.ticketClosed"),
            );
        }

        const now = new Date();
        const status = dto.close ? TicketStatus.CLOSED : TicketStatus.RESOLVED;

        const [, updated] = await this.prisma.$transaction([
            this.prisma.supportMessage.create({
                data: {
                    ticketId: id,
                    senderId: user.id,
                    senderRole: user.role,
                    body: dto.resolution,
                    isInternal: false,
                },
            }),
            this.prisma.supportTicket.update({
                where: { id },
                data: {
                    status,
                    resolution: dto.resolution,
                    resolvedAt: now,
                    lastMessageAt: now,
                    firstResponseAt: ticket.firstResponseAt ?? now,
                    assignedToId: ticket.assignedToId ?? user.id,
                },
            }),
        ]);

        if (dto.notifyCustomer ?? true) {
            await this.notifyOwner(
                ticket.userId,
                "support.notification.resolved",
                dto.resolution,
                id,
            );
        }

        return updated;
    }

    /**
     * Complaint KPIs for a window of created dates: volumes by status /
     * category / priority, backlog, response & resolution times, daily trend.
     * `storeId` null = all stores (admin).
     */
    async summary(storeId: bigint | null, query: SupportSummaryInput) {
        const to = query.to ? new Date(query.to.slice(0, 10)) : new Date(new Date().toISOString().slice(0, 10));
        const from = query.from ? new Date(query.from.slice(0, 10)) : addDays(to, -29);
        const end = addDays(to, 1);

        const scope = storeId == null ? Prisma.empty : Prisma.sql`AND "storeId" = ${storeId}`;
        const where: Prisma.SupportTicketWhereInput = {
            ...(storeId != null && { storeId }),
            createdAt: { gte: from, lt: end },
        };

        const [byStatus, byCategory, byPriority, backlog, unassigned, [times], trend] =
            await Promise.all([
                this.prisma.supportTicket.groupBy({ by: ["status"], where, _count: { _all: true } }),
                this.prisma.supportTicket.groupBy({ by: ["category"], where, _count: { _all: true } }),
                this.prisma.supportTicket.groupBy({ by: ["priority"], where, _count: { _all: true } }),
                // Backlog is "right now", independent of the window.
                this.prisma.supportTicket.groupBy({
                    by: ["priority"],
                    where: {
                        ...(storeId != null && { storeId }),
                        status: { in: OPEN_STATUSES },
                    },
                    _count: { _all: true },
                }),
                this.prisma.supportTicket.count({
                    where: {
                        ...(storeId != null && { storeId }),
                        status: { in: OPEN_STATUSES },
                        assignedToId: null,
                    },
                }),
                this.prisma.$queryRaw<any[]>`
                    SELECT
                      AVG(EXTRACT(EPOCH FROM ("firstResponseAt" - "createdAt")) / 60)
                        FILTER (WHERE "firstResponseAt" IS NOT NULL) AS "avgFirstResponseMinutes",
                      AVG(EXTRACT(EPOCH FROM ("resolvedAt" - "createdAt")) / 3600)
                        FILTER (WHERE "resolvedAt" IS NOT NULL) AS "avgResolutionHours"
                    FROM "SupportTicket"
                    WHERE "createdAt" >= ${from} AND "createdAt" < ${end} ${scope}`,
                this.prisma.$queryRaw<any[]>`
                    SELECT date_trunc('day', "createdAt")::date AS "day",
                           COUNT(*)::int AS "created",
                           COUNT(*) FILTER (WHERE status IN ('RESOLVED','CLOSED'))::int AS "resolved"
                    FROM "SupportTicket"
                    WHERE "createdAt" >= ${from} AND "createdAt" < ${end} ${scope}
                    GROUP BY 1 ORDER BY 1`,
            ]);

        const counts = <K extends string>(rows: ({ _count: { _all: number } } & Record<K, string>)[], key: K) =>
            Object.fromEntries(rows.map((r) => [r[key], r._count._all]));
        const total = byStatus.reduce((sum, r) => sum + r._count._all, 0);
        const resolved = byStatus
            .filter((r) => r.status === TicketStatus.RESOLVED || r.status === TicketStatus.CLOSED)
            .reduce((sum, r) => sum + r._count._all, 0);
        const round = (v: unknown, d = 1) =>
            v == null ? null : Math.round(Number(v) * 10 ** d) / 10 ** d;

        return {
            from: from.toISOString().slice(0, 10),
            to: to.toISOString().slice(0, 10),
            total,
            resolved,
            resolutionRate: total ? round((resolved / total) * 100) : 0,
            byStatus: counts(byStatus, "status"),
            byCategory: counts(byCategory, "category"),
            byPriority: counts(byPriority, "priority"),
            backlog: {
                open: backlog.reduce((sum, r) => sum + r._count._all, 0),
                byPriority: counts(backlog, "priority"),
                unassigned,
            },
            avgFirstResponseMinutes: round(times?.avgFirstResponseMinutes),
            avgResolutionHours: round(times?.avgResolutionHours),
            trend: trend.map((t) => ({
                day: (t.day as Date).toISOString().slice(0, 10),
                created: t.created,
                resolved: t.resolved,
            })),
        };
    }
}
