import { AppConfig } from "@config/config.type";
import { PrismaService } from "@core/database/prisma.service";
import { MediaService } from "@modules/media/media.service";
import { ConflictException, Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { MediaPurpose, MediaStatus } from "@prisma-client/enums";

@Injectable()
export class MediaCleanupService implements OnModuleInit, OnModuleDestroy {
    private readonly log = new Logger(MediaCleanupService.name);
    private readonly jobs: AppConfig["media"]["jobs"];
    private timer?: NodeJS.Timeout;
    private busy = false;

    constructor(
        private readonly prisma: PrismaService,
        private readonly media: MediaService,
        config: ConfigService,
    ) {
        this.jobs = config.getOrThrow<AppConfig["media"]>("media").jobs;
    }

    onModuleInit() {
        this.timer = setInterval(() => void this.run(), this.jobs.cleanupIntervalMs);
        this.timer.unref();
    }
    onModuleDestroy() {
        if (this.timer) clearInterval(this.timer);
    }

    async run() {
        if (this.busy) return;
        this.busy = true;
        try {
            await this.sweepDeleted();
            await this.sweepAbandoned();
            await this.sweepFailed();
            if (this.jobs.orphanSweepEnabled) await this.sweepOrphans();
        } catch (e) {
            this.log.error(`cleanup failed: ${e}`);
        } finally {
            this.busy = false;
        }
    }

    /** Soft-deleted rows are the purge queue: delete storage objects first, then the row (safe to retry). */
    private async sweepDeleted() {
        const rows = await this.prisma.mediaFile.findMany({ where: { deletedAt: { not: null } }, take: 100 });
        for (const r of rows) {
            try {
                await this.media.purgeObjects(r);
                await this.prisma.mediaFile.delete({ where: { id: r.id } });
            } catch (e) {
                this.log.warn(`purge ${r.id} failed, will retry: ${e}`);
            }
        }
    }

    /** Uploads initiated but never completed. */
    private async sweepAbandoned() {
        const cutoff = new Date(Date.now() - this.jobs.pendingTtlHours * 3_600_000);
        const rows = await this.prisma.mediaFile.findMany({
            where: { status: MediaStatus.PENDING, createdAt: { lt: cutoff } },
            take: 200,
        });
        for (const r of rows) await this.media.discard(r).catch((e) => this.log.warn(`${r.id}: ${e}`));
    }

    /** Failed processing, after the retry window. */
    private async sweepFailed() {
        const cutoff = new Date(Date.now() - this.jobs.failedTtlDays * 86_400_000);
        const rows = await this.prisma.mediaFile.findMany({
            where: { status: MediaStatus.FAILED, updatedAt: { lt: cutoff } },
            take: 200,
        });
        for (const r of rows) await this.media.discard(r).catch((e) => this.log.warn(`${r.id}: ${e}`));
    }

    /** OPT-IN (MEDIA_ORPHAN_SWEEP=true): READY, unused for orphanTtlDays. remove() re-checks usage under lock. */
    private async sweepOrphans() {
        const cutoff = new Date(Date.now() - this.jobs.orphanTtlDays * 86_400_000);
        const rows = await this.prisma.mediaFile.findMany({
            where: {
                status: MediaStatus.READY,
                deletedAt: null,
                createdAt: { lt: cutoff },
                purpose: { not: MediaPurpose.KYC },
            },
            orderBy: { id: "asc" },
            take: 100,
            select: { id: true },
        });
        for (const { id } of rows) {
            try {
                await this.media.remove(id);
            } catch (e) {
                if (!(e instanceof ConflictException)) this.log.warn(`orphan ${id}: ${e}`);
            }
        }
    }
}
