import { Roles } from "@common/decorators/auth.decorator";
import { ApiController } from "@common/swagger/swagger.util";
import { applyDecorators, Controller } from "@nestjs/common";
import { UserRole } from "@prisma-client/enums";

export interface StoreControllerOptions {
    /** Only the store manager (default: manager and staff). */
    managerOnly?: boolean;
    /** Swagger text of the 403 response. */
    forbidden?: string;
}

/**
 * Every controller under src/api/store (store manager / staff app): store roles, Swagger tag "Store · …",
 * bearer auth, 401 / 403. The "/store" prefix comes from RouterModule, so `path` is relative
 * ("inventory" → /store/inventory). The store is always the caller's own (StoreScopeService).
 */
export const StoreController = (
    path: string,
    tag: string,
    { managerOnly = false, forbidden }: StoreControllerOptions = {},
) =>
    applyDecorators(
        Controller(path),
        managerOnly
            ? Roles(UserRole.STORE_MANAGER)
            : Roles(UserRole.STORE_MANAGER, UserRole.STORE_STAFF),
        ApiController(
            `Store · ${tag}`,
            forbidden ??
                (managerOnly
                    ? "Not STORE_MANAGER, a required permission is missing, or no store is assigned"
                    : "Not STORE_MANAGER / STORE_STAFF, a required permission is missing, or no store is assigned"),
        ),
    );
