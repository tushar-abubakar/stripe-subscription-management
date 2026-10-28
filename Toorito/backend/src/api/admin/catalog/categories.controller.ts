import { P } from "@common/authorization/permissions";
import { Permissions } from "@common/decorators/auth.decorator";
import { ParseBigIntPipe } from "@core/http/pipes/parse-bigint.pipe";
import {
    CategoryBulkStatusDto,
    CategoryDto,
    CategoryListQuery,
    CategoryStatusDto,
    CheckCategorySlugQuery,
} from "./category.dto";
import { CategoryService } from "@modules/catalog/category/category.service";
import {
    ApiAdminCategoryGet,
    ApiAdminCategoryList,
    ApiBulkSetCategoryStatus,
    ApiCheckCategorySlug,
    ApiCreateCategory,
    ApiDeleteCategory,
    ApiSetCategoryStatus,
    ApiUpdateCategory,
} from "./category.swagger";
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

/** Admin category management. */
@AdminController("catalog/categories", "Categories")
export class AdminCategoriesController {
    constructor(private readonly categories: CategoryService) {}

    @Permissions(P.CATEGORY_READ)
    @ApiAdminCategoryList()
    @Get()
    list(@Query() query: CategoryListQuery) {
        return this.categories.adminList(query);
    }

    // Must stay ABOVE ":id", otherwise "check-slug" is parsed as an id.
    @Permissions(P.CATEGORY_CREATE, P.CATEGORY_UPDATE)
    @ApiCheckCategorySlug()
    @Get("check-slug")
    checkSlug(@Query() query: CheckCategorySlugQuery) {
        return this.categories.checkSlug(query);
    }

    @Permissions(P.CATEGORY_READ)
    @ApiAdminCategoryGet()
    @Get(":id")
    get(@Param("id", ParseBigIntPipe) id: bigint) {
        return this.categories.adminGet(id);
    }

    @Permissions(P.CATEGORY_CREATE)
    @ApiCreateCategory()
    @Post()
    create(@Body() dto: CategoryDto) {
        return this.categories.upsert(dto);
    }

    @Permissions(P.CATEGORY_UPDATE)
    @ApiUpdateCategory()
    @Put(":id")
    update(@Param("id", ParseBigIntPipe) id: bigint, @Body() dto: CategoryDto) {
        return this.categories.upsert(dto, id);
    }

    // Must stay ABOVE ":id/status", otherwise "bulk" is parsed as an id.
    @Permissions(P.CATEGORY_UPDATE)
    @ApiBulkSetCategoryStatus()
    @Patch("bulk/status")
    bulkSetStatus(@Body() dto: CategoryBulkStatusDto) {
        return this.categories.bulkSetStatus(dto);
    }

    @Permissions(P.CATEGORY_UPDATE)
    @ApiSetCategoryStatus()
    @Patch(":id/status")
    setStatus(
        @Param("id", ParseBigIntPipe) id: bigint,
        @Body() dto: CategoryStatusDto,
    ) {
        return this.categories.setStatus(id, dto);
    }

    @Permissions(P.CATEGORY_DELETE)
    @ApiDeleteCategory()
    @Delete(":id")
    remove(@Param("id", ParseBigIntPipe) id: bigint) {
        return this.categories.remove(id);
    }
}
