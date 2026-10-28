import { Roles } from "@common/decorators/auth.decorator";
import { ApiController } from "@common/swagger/swagger.util";
import { applyDecorators, Controller } from "@nestjs/common";
import { UserRole } from "@prisma-client/enums";

/**
 * Every controller under src/api/partner (delivery partner app): DELIVERY_PARTNER role, Swagger tag
 * "Partner · …", bearer auth, 401 / 403. The "/partner" prefix comes from RouterModule.
 */
export const PartnerController = (
    path: string,
    tag: string,
    forbidden = "Not DELIVERY_PARTNER",
) =>
    applyDecorators(
        Controller(path),
        Roles(UserRole.DELIVERY_PARTNER),
        ApiController(`Partner · ${tag}`, forbidden),
    );
