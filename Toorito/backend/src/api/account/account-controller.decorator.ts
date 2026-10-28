import { ApiController } from "@common/swagger/swagger.util";
import { applyDecorators, Controller } from "@nestjs/common";

/**
 * Every controller under src/api/account: the signed-in user's own things, any role (profile, avatar,
 * phone, wallet, notifications, approvals, uploads). A bearer token is required; single endpoints may
 * narrow the roles with @Roles. The "/account" prefix comes from RouterModule.
 */
export const AccountController = (
    path: string,
    tag: string,
    forbidden = "Endpoint not available for your role",
) =>
    applyDecorators(
        Controller(path),
        ApiController(`Account · ${tag}`, forbidden),
    );
