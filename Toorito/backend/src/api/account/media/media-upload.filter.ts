import { resolveMaxUploadBytes } from "@modules/media/media.config";
import { ArgumentsHost, Catch, PayloadTooLargeException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { BaseExceptionFilter } from "@nestjs/core";
import { I18nService } from "nestjs-i18n";

/**
 * Multer rejects oversized files before the service runs, with an English
 * message. This filter re-issues the same 413 with a translated message.
 */
@Catch(PayloadTooLargeException)
export class MediaUploadExceptionFilter extends BaseExceptionFilter {
    constructor(
        private readonly i18n: I18nService,
        private readonly config: ConfigService,
    ) {
        super();
    }

    catch(_exception: PayloadTooLargeException, host: ArgumentsHost) {
        const maxBytes = resolveMaxUploadBytes(this.config);
        super.catch(
            new PayloadTooLargeException(
                this.i18n.translate("media.file.tooLarge", {
                    args: { maxMb: Math.round((maxBytes / 1024 / 1024) * 10) / 10 },
                }),
            ),
            host,
        );
    }
}
