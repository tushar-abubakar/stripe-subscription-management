import {
    LocalStorageDriver,
    STORAGE_DRIVER,
    type StorageProvider,
} from "@integrations/storage/storage.driver";
import { MediaCleanupService } from "./media-cleanup.service";
import { MediaProcessor } from "./media-processor.service";
import { MediaUsageService } from "./media-usage.service";
import { resolveMaxUploadBytes } from "./media.config";
import { MediaService } from "./media.service";
import { Global, Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { MulterModule } from "@nestjs/platform-express";

// Must match the static prefix registered in main.ts.
const DEFAULT_LOCAL_BASE_URL = "/static";

interface MediaConfig {
    provider?: StorageProvider;
    localDir?: string;
    baseUrl?: string;
}

@Global()
@Module({
    imports: [
        // Multer ceiling = largest per-type limit from AppConfig (media.image/video/audio/document.maxBytes).
        // MediaService enforces the exact per-type limit. No `storage` option: multer's
        // default is in-memory, which is what MediaService expects (`file.buffer`).
        MulterModule.registerAsync({
            inject: [ConfigService],
            useFactory: (config: ConfigService) => ({
                limits: {
                    fileSize: resolveMaxUploadBytes(config),
                    files: 1,
                },
            }),
        }),
    ],
    providers: [
        MediaService,
        MediaUsageService,
        MediaProcessor, // background image processing (DB-backed queue)
        MediaCleanupService, // abandoned / failed / deleted media sweeps
        {
            provide: STORAGE_DRIVER,
            inject: [ConfigService],
            useFactory: (config: ConfigService) => {
                const m = config.get<MediaConfig>("media"); // validated by configuration.ts
                if (!m?.provider) {
                    throw new Error("Missing configuration: media.provider");
                }
                switch (m.provider) {
                    case "LOCAL":
                        if (!m.localDir) {
                            throw new Error(
                                "Missing configuration: media.localDir is required for the LOCAL provider",
                            );
                        }
                        // Relative URL when no public base URL is configured
                        // (e.g. dev / e2e); set MEDIA_PUBLIC_BASE_URL for a CDN or full host.
                        return new LocalStorageDriver(
                            m.localDir,
                            m.baseUrl || DEFAULT_LOCAL_BASE_URL,
                        );
                    default:
                        throw new Error(
                            `Media provider "${m.provider}" is not implemented yet — implement StorageDriver (src/integrations/storage/storage.driver.ts)`,
                        );
                }
            },
        },
    ],
    exports: [MediaService, MediaUsageService, STORAGE_DRIVER],
})
export class MediaModule {}
