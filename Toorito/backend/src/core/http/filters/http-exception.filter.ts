import { parseMessageKey } from "@common/utils/localeMessage.util";
import { LocaleService } from "@core/locale/locale.service";
import {
    ArgumentsHost,
    Catch,
    ExceptionFilter,
    HttpException,
    HttpStatus,
    Logger,
} from "@nestjs/common";
import { Response } from "express";
import { I18nContext, I18nService } from "nestjs-i18n";

/** Prisma error codes that deserve a friendly HTTP status instead of a 500. */
const PRISMA_STATUS: Record<string, { status: number; key: string }> = {
    P2002: { status: HttpStatus.CONFLICT, key: "common.errors.duplicate" },
    P2003: {
        status: HttpStatus.CONFLICT,
        key: "common.errors.relatedRecord",
    },
    P2025: { status: HttpStatus.NOT_FOUND, key: "common.errors.notFound" },
};

/**
 * Global exception filter.
 *
 * - Translates every message through `I18nService.translate()` in the
 *   caller's language (messages may be a translation key, a
 *   `{ key, args }` envelope, or already translated text).
 * - Maps Prisma "known request" errors to 404 / 409 instead of a 500.
 * - Never leaks internal error details; unexpected errors are logged with the
 *   request id and returned as a generic, translated 500.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
    private readonly logger = new Logger(AllExceptionsFilter.name);

    constructor(
        private readonly i18n: I18nService,
        private readonly locale: LocaleService,
    ) {}

    catch(exception: unknown, host: ArgumentsHost): void {
        const http = host.switchToHttp();
        const response = http.getResponse<Response>();
        const request = http.getRequest<{ requestId?: string }>();

        const { status, body } = this.build(exception, request.requestId);

        response.status(status).json(body);
    }

    private build(
        exception: unknown,
        requestId?: string,
    ): { status: number; body: Record<string, unknown> } {
        if (exception instanceof HttpException) {
            const raw = exception.getResponse();
            const body: Record<string, unknown> =
                typeof raw === "string" ? { message: raw } : { ...raw };

            body.message = Array.isArray(body.message)
                ? body.message.map((message) => this.translate(message))
                : this.translate(body.message);
            body.statusCode = exception.getStatus();
            body.requestId = requestId;

            return { status: exception.getStatus(), body };
        }

        const prismaCode = (exception as { code?: string })?.code;
        const mapped = prismaCode ? PRISMA_STATUS[prismaCode] : undefined;

        if (mapped && (exception as Error)?.name?.startsWith("PrismaClient")) {
            return {
                status: mapped.status,
                body: {
                    statusCode: mapped.status,
                    message: this.translate(mapped.key),
                    requestId,
                },
            };
        }

        this.logger.error(
            `Unhandled exception (requestId=${requestId ?? "n/a"})`,
            (exception as Error)?.stack ?? String(exception),
        );

        return {
            status: HttpStatus.INTERNAL_SERVER_ERROR,
            body: {
                statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
                message: this.translate("common.errors.internal"),
                requestId,
            },
        };
    }

    /**
     * Resolves one message to text in the caller's language.
     * Plain text that is not a known key is returned unchanged.
     */
    private translate(message: unknown): unknown {
        if (typeof message !== "string") {
            return message;
        }

        const lang = I18nContext.current()?.lang ?? this.locale.defaultLanguage;
        const envelope = parseMessageKey(message);
        const key = envelope?.key ?? message;

        // Only dotted identifiers can be keys; skip free text cheaply.
        if (!/^[A-Za-z][\w-]*(\.[\w-]+)+$/.test(key)) {
            return message;
        }

        const translated = this.i18n.translate(key, {
            lang,
            args: envelope?.args,
        });

        return typeof translated === "string" && translated !== key
            ? translated
            : message;
    }
}
