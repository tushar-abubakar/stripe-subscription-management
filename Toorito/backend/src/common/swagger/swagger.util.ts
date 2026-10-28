/**
 * Small shared Swagger helpers for modules added later (approvals, kyc,
 * staff). Older modules keep their own copies in their *.swagger.ts files.
 */
import { applyDecorators } from "@nestjs/common";
import {
    ApiBearerAuth,
    ApiForbiddenResponse,
    ApiHeader,
    ApiParam,
    ApiTags,
    ApiUnauthorizedResponse,
} from "@nestjs/swagger";

export function errorSchema(statusCode: number, error: string, message: string | string[], code?: string) {
    return {
        type: "object",
        properties: {
            statusCode: { type: "number", example: statusCode },
            message: { oneOf: [{ type: "string" }, { type: "array", items: { type: "string" } }], example: message },
            error: { type: "string", example: error },
            ...(code && { code: { type: "string", example: code } }),
        },
    };
}

export const causes = (title: string, list: string[]) =>
    `${title}\n\nPossible causes:\n${list.map((c) => `- ${c}`).join("\n")}`;

/** Tag + bearer + Accept-Language + 401 / 403 for a controller. */
export const ApiController = (tag: string, forbidden: string) =>
    applyDecorators(
        ApiTags(tag),
        ApiBearerAuth(),
        ApiHeader({ name: "Accept-Language", required: false, example: "en", description: "Language of messages and labels" }),
        ApiUnauthorizedResponse({ description: "Missing, invalid or expired token", schema: errorSchema(401, "Unauthorized", "Unauthorized") }),
        ApiForbiddenResponse({ description: forbidden, schema: errorSchema(403, "Forbidden", "Forbidden resource") }),
    );

export const IdParam = (name: string, what: string, example: string) =>
    ApiParam({ name, description: `${what} (bigint as numeric string)`, schema: { type: "string", pattern: "^\\d+$" }, example });

export const money = (amount: number) => ({
    amount,
    currency: "BDT",
    symbol: "৳",
    formatted: `৳${amount.toLocaleString("en", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
});
