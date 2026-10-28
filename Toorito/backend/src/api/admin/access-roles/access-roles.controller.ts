import { P } from "@common/authorization/permissions";
import { Permissions, Roles } from "@common/decorators/auth.decorator";
import { ParseBigIntPipe } from "@core/http/pipes/parse-bigint.pipe";
import { AccessRoleDto } from "../users/users.dto";
import { UsersService } from "@modules/users/users.service";
import {
    ApiCreateAccessRole,
    ApiListAccessRoles,
    ApiListPermissions,
    ApiUpdateAccessRole,
} from "../users/users.swagger";
import { Body, Get, Param, Post, Put } from "@nestjs/common";
import { UserRole } from "@prisma-client/enums";
import { AdminController } from "../admin-controller.decorator";

/** Admin: access roles (permission sets for ADMIN users). */
@AdminController(
    "access-roles",
    "Access roles",
    "Not SUPER_ADMIN (or missing `accessrole.manage` for the permission list)",
)
export class AdminAccessRolesController {
    constructor(private readonly users: UsersService) {}

    @Roles(UserRole.SUPER_ADMIN)
    @ApiListAccessRoles()
    @Get()
    list() {
        return this.users.listAccessRoles();
    }

    // Must stay ABOVE ":id".
    @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
    @Permissions(P.ACCESS_ROLE_MANAGE)
    @ApiListPermissions()
    @Get("permissions")
    permissions() {
        const items = Object.values(P);
        return { items, total: items.length, page: 1, limit: items.length };
    }

    @Roles(UserRole.SUPER_ADMIN)
    @ApiCreateAccessRole()
    @Post()
    create(@Body() dto: AccessRoleDto) {
        return this.users.upsertAccessRole(dto);
    }

    @Roles(UserRole.SUPER_ADMIN)
    @ApiUpdateAccessRole()
    @Put(":id")
    update(
        @Param("id", ParseBigIntPipe) id: bigint,
        @Body() dto: AccessRoleDto,
    ) {
        return this.users.upsertAccessRole(dto, id);
    }
}
