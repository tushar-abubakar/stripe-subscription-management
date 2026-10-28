import { Public, Roles } from "@common/decorators/auth.decorator";
import { ApiController } from "@common/swagger/swagger.util";
import { applyDecorators, Controller } from "@nestjs/common";
import { ApiBearerAuth, ApiHeader, ApiTags } from "@nestjs/swagger";
import { UserRole } from "@prisma-client/enums";

/**
 * Who may call a customer-app controller:
 * - "guest"    no token needed; a bearer token, when sent, identifies the customer (screens, cart, store lookup),
 * - "customer" signed-in CUSTOMER only (orders, addresses, wishlist, returns),
 * - "user"     any signed-in user (support tickets).
 */
export type AppAccess = "guest" | "customer" | "user";

/**
 * Every controller under src/api/app (customer Flutter app): Swagger tag "App · …", bearer auth and the
 * access rule above. The "/app" prefix comes from RouterModule.
 */
export const AppController = (
    path: string,
    tag: string,
    access: AppAccess = "guest",
) =>
    applyDecorators(
        Controller(path),
        ...(access === "guest"
            ? [
                  Public(),
                  ApiTags(`App · ${tag}`),
                  ApiBearerAuth(),
                  ApiHeader({
                      name: "Accept-Language",
                      required: false,
                      example: "bn",
                      description: "Language of texts",
                  }),
              ]
            : [
                  ...(access === "customer" ? [Roles(UserRole.CUSTOMER)] : []),
                  ApiController(
                      `App · ${tag}`,
                      access === "customer"
                          ? "Not CUSTOMER"
                          : "Endpoint not available for your role",
                  ),
              ]),
    );
