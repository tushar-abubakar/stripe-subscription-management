import { P } from "@common/authorization/permissions";
import { CurrentUser, Permissions } from "@common/decorators/auth.decorator";
import { ListResponseDto } from "@common/dto/list-response.dto";
import { AuthUser } from "@common/types/auth.type";
import { ParseBigIntPipe } from "@core/http/pipes/parse-bigint.pipe";
import {
    BundleDto,
    StoreBundleListQuery,
} from "../../admin/catalog/bundle.dto";
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
import { StoreController } from "../store-controller.decorator";

@StoreController("bundles", "Bundles", { managerOnly: true })
export class StoreBundlesController {
    constructor(private readonly bundles: BundlesService) {}

    @Permissions(P.BUNDLE_READ)
    @ApiOkResponse({ type: ListResponseDto })
    @Get()
    storeList(
        @CurrentUser() user: AuthUser,
        @Query() query: StoreBundleListQuery,
    ) {
        return this.bundles.storeList(user, query);
    }

    @Permissions(P.BUNDLE_WRITE)
    @Post()
    storeCreate(@Body() dto: BundleDto, @CurrentUser() user: AuthUser) {
        return this.bundles.save(dto, user);
    }

    @Permissions(P.BUNDLE_WRITE)
    @Patch(":id")
    storeUpdate(
        @Param("id", ParseBigIntPipe) id: bigint,
        @Body() dto: BundleDto,
        @CurrentUser() user: AuthUser,
    ) {
        return this.bundles.save(dto, user, id);
    }

    @Permissions(P.BUNDLE_WRITE)
    @Delete(":id")
    @HttpCode(200)
    storeRemove(
        @Param("id", ParseBigIntPipe) id: bigint,
        @CurrentUser() user: AuthUser,
    ) {
        return this.bundles.remove(id, user);
    }
}
