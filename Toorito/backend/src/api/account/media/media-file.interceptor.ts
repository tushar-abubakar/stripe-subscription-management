import { resolveMaxUploadBytes } from "@modules/media/media.config";
import {
    CallHandler,
    ExecutionContext,
    Injectable,
    NestInterceptor,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { FileInterceptor } from "@nestjs/platform-express";

/**
 * FileInterceptor needs its limit when the decorator is evaluated (before ConfigService exists).
 * This wrapper builds it at runtime from AppConfig, so the largest configured limit
 * (video/audio/document/image) is the multer ceiling; the per-kind limit is enforced in MediaService.
 */
@Injectable()
export class MediaFileInterceptor implements NestInterceptor {
    private readonly inner: NestInterceptor;
    constructor(config: ConfigService) {
        const Mixin = FileInterceptor("file", {
            limits: { fileSize: resolveMaxUploadBytes(config), files: 1 },
        });
        this.inner = new Mixin();
    }
    intercept(ctx: ExecutionContext, next: CallHandler) {
        return this.inner.intercept(ctx, next);
    }
}
