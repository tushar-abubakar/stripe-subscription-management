import { PageQueryDto } from "@common/dto/page-query.dto";
import { pageParams } from "@common/utils/helpers.util";
import { PrismaService } from "@core/database/prisma.service";
import { Injectable, Logger } from "@nestjs/common";

@Injectable()
export class NotificationsService {
    private readonly logger = new Logger(NotificationsService.name);

    constructor(private readonly prisma: PrismaService) {}
    /** In-app inbox row; push delivery (FCM/APNs via Session.pushToken) plugs in below. Never throws. */
    async notify(
        userId: bigint,
        type: string,
        title: string,
        body: string,
        data?: Record<string, any>,
    ) {
        try {
            await this.prisma.notification.create({
                data: { userId, type, title, body, data: data as any },
            });
            // const tokens = await this.prisma.session.findMany({ where: { userId, revokedAt: null, pushToken: { not: null } }, select: { pushToken: true } });
            // await fcm.sendEach(tokens...)
        } catch (error) {
            // A failed inbox write must never break the business flow.
            this.logger.warn(`notify failed: ${(error as Error).message}`);
        }
    }
    list(userId: bigint, q: PageQueryDto) {
        const { take, skip } = pageParams(q);
        return this.prisma.notification.findMany({
            where: { userId },
            orderBy: { id: "desc" },
            take,
            skip,
        });
    }
    unread(userId: bigint) {
        return this.prisma.notification.count({
            where: { userId, readAt: null },
        });
    }
    async read(userId: bigint, id?: bigint) {
        await this.prisma.notification.updateMany({
            where: { userId, readAt: null, ...(id ? { id } : {}) },
            data: { readAt: new Date() },
        });
        return { success: true };
    }
}
