import { Injectable, NestMiddleware } from "@nestjs/common";
import { v4 as uuid } from "uuid";

/** Tags every request with an id (also returned as `x-request-id`) for log correlation. */
@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
    use(
        request: { headers: Record<string, unknown>; requestId?: string },
        response: { setHeader(name: string, value: string): void },
        next: () => void,
    ): void {
        const incoming = request.headers["x-request-id"];

        // Only accept sane ids from clients; never reflect arbitrary input into headers.
        request.requestId =
            typeof incoming === "string" && /^[\w.-]{8,64}$/.test(incoming)
                ? incoming
                : uuid();

        response.setHeader("x-request-id", request.requestId);
        next();
    }
}
