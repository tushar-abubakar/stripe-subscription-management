import { Public } from "@common/decorators/auth.decorator";
import { applyDecorators, Controller } from "@nestjs/common";
import { ApiHeader, ApiTags } from "@nestjs/swagger";

/**
 * Every controller under src/api/public: open endpoints (health, webhooks, app config, open catalogue).
 * No token needed. The "/public" prefix comes from RouterModule.
 */
export const PublicController = (path: string, tag: string) =>
    applyDecorators(
        Controller(path),
        Public(),
        ApiTags(`Public · ${tag}`),
        ApiHeader({
            name: "Accept-Language",
            required: false,
            example: "en",
            description: "Language of texts",
        }),
    );
