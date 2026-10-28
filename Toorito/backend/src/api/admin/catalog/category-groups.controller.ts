import { P } from "@common/authorization/permissions";
import { Permissions } from "@common/decorators/auth.decorator";
import { ParseBigIntPipe } from "@core/http/pipes/parse-bigint.pipe";
import { CategoryGroupService } from "@modules/catalog/category-group/category-group.service";
import {
    Body,
    Delete,
    Get,
    Param,
    Patch,
    Post,
    Put,
    Query,
} from "@nestjs/common";
import { AdminController } from "../admin-controller.decorator";
import {
    CategoryGroupDto,
    CategoryGroupListQuery,
    CategoryGroupStatusDto,
} from "./category-group.dto";
import {
    ApiCategoryGroupCreate,
    ApiCategoryGroupDelete,
    ApiCategoryGroupGet,
    ApiCategoryGroupList,
    ApiCategoryGroupStatus,
    ApiCategoryGroupUpdate,
} from "./category-group.swagger";

/** Category groups: display grouping of categories (no products). Uses the category permissions. */
@Permissions(P.CATEGORY_READ)
@AdminController("catalog/category-groups", "Category groups")
export class AdminCategoryGroupsController {
    constructor(private readonly groups: CategoryGroupService) {}

    @ApiCategoryGroupList()
    @Get()
    list(@Query() query: CategoryGroupListQuery) {
        return this.groups.adminList(query);
    }

    @ApiCategoryGroupGet()
    @Get(":id")
    get(@Param("id", ParseBigIntPipe) id: bigint) {
        return this.groups.adminGet(id);
    }

    @Permissions(P.CATEGORY_CREATE)
    @ApiCategoryGroupCreate()
    @Post()
    create(@Body() dto: CategoryGroupDto) {
        return this.groups.upsert(dto);
    }

    @Permissions(P.CATEGORY_UPDATE)
    @ApiCategoryGroupUpdate()
    @Put(":id")
    update(
        @Param("id", ParseBigIntPipe) id: bigint,
        @Body() dto: CategoryGroupDto,
    ) {
        return this.groups.upsert(dto, id);
    }

    @Permissions(P.CATEGORY_UPDATE)
    @ApiCategoryGroupStatus()
    @Patch(":id/status")
    setStatus(
        @Param("id", ParseBigIntPipe) id: bigint,
        @Body() dto: CategoryGroupStatusDto,
    ) {
        return this.groups.setStatus(id, dto.status);
    }

    @Permissions(P.CATEGORY_DELETE)
    @ApiCategoryGroupDelete()
    @Delete(":id")
    remove(@Param("id", ParseBigIntPipe) id: bigint) {
        return this.groups.remove(id);
    }
}
