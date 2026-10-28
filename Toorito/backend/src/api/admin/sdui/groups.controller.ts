import { P } from "@common/authorization/permissions";
import { CurrentUser, Permissions } from "@common/decorators/auth.decorator";
import { AuthUser } from "@common/types/auth.type";
import { ParseBigIntPipe } from "@core/http/pipes/parse-bigint.pipe";
import { LibraryService } from "@modules/sdui/library.service";
import {
    Body,
    Delete,
    Get,
    HttpCode,
    Param,
    Patch,
    Post,
    Query,
} from "@nestjs/common";
import { I18nLang } from "nestjs-i18n";
import { AdminController } from "../admin-controller.decorator";
import { CreateGroupDto, GroupListQuery, UpdateGroupDto } from "./sdui.dto";
import {
    ApiGroupCreate,
    ApiGroupDelete,
    ApiGroupGet,
    ApiGroupList,
    ApiGroupUpdate,
} from "./sdui.swagger";

const landingId = (v: number | null | undefined) =>
    v === undefined ? undefined : v === null ? null : BigInt(v);

/**
 * Custom groups ("Fresh items", "Late night sale", "Newly added"): what they contain, when they're on,
 * and which screen opens when tapped. Creating = `sdui.manage`; editing / deleting = `sdui.publish`.
 */
@Permissions(P.SDUI_READ)
@AdminController("sdui/groups", "SDUI Library")
export class AdminSduiGroupsController {
    constructor(private readonly library: LibraryService) {}

    @ApiGroupList()
    @Get()
    list(@Query() q: GroupListQuery) {
        return this.library.groups(q);
    }

    @ApiGroupGet()
    @Get(":id")
    get(@Param("id", ParseBigIntPipe) id: bigint, @I18nLang() lang: string) {
        return this.library.group(id, lang);
    }

    @Permissions(P.SDUI_MANAGE)
    @ApiGroupCreate()
    @Post()
    @HttpCode(200)
    create(@Body() dto: CreateGroupDto, @CurrentUser() user: AuthUser) {
        return this.library.createGroup(
            { ...dto, landingScreenId: landingId(dto.landingScreenId) },
            user,
        );
    }

    @Permissions(P.SDUI_PUBLISH)
    @ApiGroupUpdate()
    @Patch(":id")
    update(
        @Param("id", ParseBigIntPipe) id: bigint,
        @Body() dto: UpdateGroupDto,
        @CurrentUser() user: AuthUser,
    ) {
        return this.library.updateGroup(
            id,
            { ...dto, landingScreenId: landingId(dto.landingScreenId) },
            user,
        );
    }

    @Permissions(P.SDUI_PUBLISH)
    @ApiGroupDelete()
    @Delete(":id")
    remove(
        @Param("id", ParseBigIntPipe) id: bigint,
        @CurrentUser() user: AuthUser,
    ) {
        return this.library.deleteGroup(id, user);
    }
}
