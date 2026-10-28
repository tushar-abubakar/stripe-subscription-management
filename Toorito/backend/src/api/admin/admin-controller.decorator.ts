import { Roles } from "@common/decorators/auth.decorator";
import { ApiController } from "@common/swagger/swagger.util";
import { applyDecorators, Controller } from "@nestjs/common";
import { UserRole } from "@prisma-client/enums";

/**
 * Every controller under src/api/admin: admin roles, Swagger tag "Admin · …",
 * bearer auth, 401 / 403. The "/admin" prefix comes from RouterModule, so
 * `path` is relative ("sdui/screens" → /admin/sdui/screens).
 */
export const AdminController = (
    path: string,
    tag: string,
    forbidden = "Not ADMIN / SUPER_ADMIN, or a required permission is missing",
) =>
    applyDecorators(
        Controller(path),
        Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN),
        ApiController(`Admin · ${tag}`, forbidden),
    );
