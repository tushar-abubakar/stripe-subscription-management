import { P } from "@common/authorization/permissions";
import { CurrentUser, Permissions } from "@common/decorators/auth.decorator";
import { ListResponseDto } from "@common/dto/list-response.dto";
import { AuthUser } from "@common/types/auth.type";
import { ParseBigIntPipe } from "@core/http/pipes/parse-bigint.pipe";
import { AdminBundleListQuery, BundleDto } from "./bundle.dto";
import { BundlesService } from "@modules/catalog/bundles/bundles.service";
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
import { ApiOkResponse } from "@nestjs/swagger";
import { AdminController } from "../admin-controller.decorator";

@AdminController("catalog/bundles", "Bundles")
export class AdminBundlesController {
    constructor(private readonly bundles: BundlesService) {}

    @Permissions(P.BUNDLE_READ)
    @ApiOkResponse({ type: ListResponseDto })
    @Get()
    adminList(@Query() query: AdminBundleListQuery) {
        return this.bundles.adminList(query);
    }

    @Permissions(P.BUNDLE_WRITE)
    @Post()
    adminCreate(@Body() dto: BundleDto, @CurrentUser() user: AuthUser) {
        return this.bundles.save(dto, user);
    }

    @Permissions(P.BUNDLE_WRITE)
    @Patch(":id")
    adminUpdate(
        @Param("id", ParseBigIntPipe) id: bigint,
        @Body() dto: BundleDto,
        @CurrentUser() user: AuthUser,
    ) {
        return this.bundles.save(dto, user, id);
    }

    @Permissions(P.BUNDLE_WRITE)
    @Delete(":id")
    @HttpCode(200)
    adminRemove(
        @Param("id", ParseBigIntPipe) id: bigint,
        @CurrentUser() user: AuthUser,
    ) {
        return this.bundles.remove(id, user);
    }
}
