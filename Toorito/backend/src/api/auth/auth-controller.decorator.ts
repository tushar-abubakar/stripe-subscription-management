import { applyDecorators, Controller } from "@nestjs/common";
import { ApiHeader, ApiTags } from "@nestjs/swagger";

/**
 * Every controller under src/api/auth: login, OTP, refresh, logout. Each endpoint says itself whether it
 * is @Public. The "/auth" prefix comes from RouterModule.
 */
export const AuthApiController = (path: string, tag: string) =>
    applyDecorators(
        Controller(path),
        ApiTags(`Auth · ${tag}`),
        ApiHeader({
            name: "Accept-Language",
            required: false,
            example: "en",
            description: "Language of messages",
        }),
    );
