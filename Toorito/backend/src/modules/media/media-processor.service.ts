import { AppConfig } from "@config/config.type";
import { PrismaService } from "@core/database/prisma.service";
import {
    STORAGE_DRIVER,
    StorageDriver,
} from "@integrations/storage/storage.driver";
import { inspectImage, renderVariants } from "@modules/media/media-image";
import { buildProfileMap, ProfileMap } from "@modules/media/media.config";
import { buildKey, MediaRuleError } from "@modules/media/media.utils";
import {
    Inject,
    Injectable,
    Logger,
    OnModuleDestroy,
    OnModuleInit,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Prisma } from "@prisma-client/client";
import { MediaStatus } from "@prisma-client/enums";

type Row = Prisma.MediaFileGetPayload<object>;

/**
 * DB-backed queue on MediaFile itself: rows in PROCESSING are claimed with
 * FOR UPDATE SKIP LOCKED (safe with many instances, no Redis, no extra table).
 * While PROCESSING, `key` is the temporary original; it becomes the master key at READY.
 */
@Injectable()
export class MediaProcessor implements OnModuleInit, OnModuleDestroy {
    private readonly log = new Logger(MediaProcessor.name);
    private readonly jobs: AppConfig["media"]["jobs"];
    private readonly profiles: ProfileMap;
    private timer?: NodeJS.Timeout;
    private running = false;
    private again = false;

    constructor(
        private readonly prisma: PrismaService,
        @Inject(STORAGE_DRIVER) private readonly driver: StorageDriver,
        config: ConfigService,
    ) {
        const media = config.getOrThrow<AppConfig["media"]>("media");
        this.jobs = media.jobs;
        this.profiles = buildProfileMap(media.purposes);
    }

    onModuleInit() {
        this.timer = setInterval(
            () => void this.tick(),
            this.jobs.pollIntervalMs,
        );
        this.timer.unref();
    }
    onModuleDestroy() {
        if (this.timer) clearInterval(this.timer);
    }
    kick() {
        setImmediate(() => void this.tick());
    }

    private async tick() {
        if (this.running) {
            this.again = true;
            return;
        }
        this.running = true;
        try {
            await this.failExhausted();
            do {
                this.again = false;
                for (
                    let row = await this.claim();
                    row;
                    row = await this.claim()
                )
                    await this.process(row);
            } while (this.again);
        } catch (e) {
            this.log.error(`tick failed: ${e}`);
        } finally {
            this.running = false;
        }
    }

    private async claim(): Promise<Row | null> {
        const { maxAttempts, lockTtlSec } = this.jobs;
        const claimed = await this.prisma.$queryRaw<{ id: bigint }[]>`
            UPDATE "MediaFile" SET "lockedAt" = now(), "attempts" = "attempts" + 1
             WHERE id = (
                SELECT id FROM "MediaFile"
                 WHERE status = 'PROCESSING'::"MediaStatus" AND "deletedAt" IS NULL
                   AND "attempts" < ${maxAttempts}
                   AND ("lockedAt" IS NULL OR "lockedAt" < now() - make_interval(secs => ${lockTtlSec}))
                 ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED)
            RETURNING id`;
        return claimed[0]
            ? this.prisma.mediaFile.findUnique({ where: { id: claimed[0].id } })
            : null;
    }

    private async failExhausted() {
        const { maxAttempts, lockTtlSec } = this.jobs;
        await this.prisma.$executeRaw`
            UPDATE "MediaFile"
               SET status = 'FAILED'::"MediaStatus", "failureReason" = 'media.processing.exhausted', "lockedAt" = NULL
             WHERE status = 'PROCESSING'::"MediaStatus" AND "attempts" >= ${maxAttempts}
               AND "lockedAt" < now() - make_interval(secs => ${lockTtlSec})`;
    }

    private async process(row: Row) {
        const written: string[] = [];
        try {
            const profile = this.profiles[row.purpose] ?? null;
            if (!profile)
                throw new MediaRuleError("media.processing.noProfile");

            const source = await this.driver.read(row.key, true); // tmp originals are always private
            await inspectImage(source, profile);
            const { master, thumb } = await renderVariants(source, profile);

            const masterKey = buildKey(
                row.purpose,
                "image",
                row.uploadedById,
                "webp",
                "master",
            );
            const thumbKey = buildKey(
                row.purpose,
                "image",
                row.uploadedById,
                "webp",
                "thumb",
            );
            await this.driver.put(
                masterKey,
                master.data,
                "image/webp",
                row.isPrivate,
            );
            written.push(masterKey);
            await this.driver.put(
                thumbKey,
                thumb.data,
                "image/webp",
                row.isPrivate,
            );
            written.push(thumbKey);

            // READY only after BOTH variants are stored.
            const res = await this.prisma.mediaFile.updateMany({
                where: {
                    id: row.id,
                    status: MediaStatus.PROCESSING,
                    deletedAt: null,
                },
                data: {
                    status: MediaStatus.READY,
                    key: masterKey,
                    mimeType: "image/webp",
                    sizeBytes: master.data.length,
                    width: master.width,
                    height: master.height,
                    variants: { master: masterKey, thumb: thumbKey },
                    lockedAt: null,
                    failureReason: null,
                },
            });
            if (res.count)
                await this.driver.remove(row.key, true).catch(() => undefined); // tmp original
            else await this.removeAll(written, row.isPrivate); // row deleted meanwhile
        } catch (e) {
            await this.removeAll(written, row.isPrivate);
            const rule = e instanceof MediaRuleError;
            this.log.warn(
                `media ${row.id} attempt ${row.attempts} failed: ${e}`,
            );
            if (rule || row.attempts >= this.jobs.maxAttempts) {
                await this.prisma.mediaFile.updateMany({
                    where: { id: row.id, status: MediaStatus.PROCESSING },
                    data: {
                        status: MediaStatus.FAILED,
                        lockedAt: null,
                        failureReason: rule
                            ? (e as MediaRuleError).key
                            : "media.processing.failed",
                    },
                });
            }
            // else lockedAt stays → retried automatically after lockTtlSec (natural back-off)
        }
    }

    private removeAll = (keys: string[], isPrivate: boolean) =>
        Promise.all(
            keys.map((k) =>
                this.driver.remove(k, isPrivate).catch(() => undefined),
            ),
        );
}
