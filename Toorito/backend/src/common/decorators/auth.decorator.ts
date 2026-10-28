import { AuthUser } from "@common/types/auth.type";
import {
    createParamDecorator,
    ExecutionContext,
    SetMetadata,
} from "@nestjs/common";
import { UserRole } from "@prisma-client/enums";

export const IS_PUBLIC = "isPublic";
export const Public = () => SetMetadata(IS_PUBLIC, true);

export const ROLES_KEY = "roles";
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);

export const PERMS_KEY = "perms";
export const Permissions = (...perms: string[]) =>
    SetMetadata(PERMS_KEY, perms);

export const CAPABILITY_KEY = "capability";
/**
 * Marks an endpoint as using a capability that a PARTIAL account hold can
 * switch off (see HOLD_RESTRICTIONS). Checked by HoldGuard.
 */
export const Capability = (...restrictions: string[]) =>
    SetMetadata(CAPABILITY_KEY, restrictions);

export const CurrentUser = createParamDecorator(
    (_: unknown, ctx: ExecutionContext): AuthUser =>
        ctx.switchToHttp().getRequest().user,
);

export const ClientIp = createParamDecorator(
    (_: unknown, ctx: ExecutionContext): string => {
        const r = ctx.switchToHttp().getRequest();
        return (
            (r.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ||
            r.ip
        );
    },
);
