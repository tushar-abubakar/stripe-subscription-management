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
import { AdminController } from "../admin-controller.decorator";
import {
    CreateSectionDto,
    SectionListQuery,
    UpdateSectionDto,
} from "./sdui.dto";
import {
    ApiSectionCreate,
    ApiSectionDelete,
    ApiSectionGet,
    ApiSectionList,
    ApiSectionUpdate,
} from "./sdui.swagger";

/**
 * Saved (reusable) sections, placed in layouts with `section_ref`.
 * Creating = `sdui.manage`; editing / deleting changes live screens, so `sdui.publish`.
 */
@Permissions(P.SDUI_READ)
@AdminController("sdui/sections", "SDUI Library")
export class AdminSduiSectionsController {
    constructor(private readonly library: LibraryService) {}

    @ApiSectionList()
    @Get()
    list(@Query() q: SectionListQuery) {
        return this.library.sections(q);
    }

    @ApiSectionGet()
    @Get(":id")
    get(@Param("id", ParseBigIntPipe) id: bigint) {
        return this.library.section(id);
    }

    @Permissions(P.SDUI_MANAGE)
    @ApiSectionCreate()
    @Post()
    @HttpCode(200)
    create(@Body() dto: CreateSectionDto, @CurrentUser() user: AuthUser) {
        return this.library.createSection(dto, user);
    }

    @Permissions(P.SDUI_PUBLISH)
    @ApiSectionUpdate()
    @Patch(":id")
    update(
        @Param("id", ParseBigIntPipe) id: bigint,
        @Body() dto: UpdateSectionDto,
        @CurrentUser() user: AuthUser,
    ) {
        return this.library.updateSection(id, dto, user);
    }

    @Permissions(P.SDUI_PUBLISH)
    @ApiSectionDelete()
    @Delete(":id")
    remove(
        @Param("id", ParseBigIntPipe) id: bigint,
        @CurrentUser() user: AuthUser,
    ) {
        return this.library.deleteSection(id, user);
    }
}
