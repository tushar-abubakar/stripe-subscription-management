import { P } from "@common/authorization/permissions";
import { Permissions } from "@common/decorators/auth.decorator";
import { ParseBigIntPipe } from "@core/http/pipes/parse-bigint.pipe";
import {
    BrandBulkStatusDto,
    BrandDto,
    BrandListQuery,
    BrandStatusDto,
    CheckBrandSlugQuery,
} from "./brand.dto";
import { BrandService } from "@modules/catalog/brand/brand.service";
import {
    ApiAdminBrandGet,
    ApiAdminBrandList,
    ApiBulkSetBrandStatus,
    ApiCheckBrandSlug,
    ApiCreateBrand,
    ApiDeleteBrand,
    ApiSetBrandStatus,
    ApiUpdateBrand,
} from "./brand.swagger";
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

/** Admin brand management. */
@AdminController("catalog/brands", "Brands")
export class AdminBrandsController {
    constructor(private readonly brands: BrandService) {}

    @Permissions(P.BRAND_READ)
    @ApiAdminBrandList()
    @Get()
    list(@Query() query: BrandListQuery) {
        return this.brands.adminList(query);
    }

    // Must stay ABOVE ":id", otherwise "check-slug" is parsed as an id.
    @Permissions(P.BRAND_CREATE, P.BRAND_UPDATE)
    @ApiCheckBrandSlug()
    @Get("check-slug")
    checkSlug(@Query() query: CheckBrandSlugQuery) {
        return this.brands.checkSlug(query);
    }

    @Permissions(P.BRAND_READ)
    @ApiAdminBrandGet()
    @Get(":id")
    get(@Param("id", ParseBigIntPipe) id: bigint) {
        return this.brands.adminGet(id);
    }

    @Permissions(P.BRAND_CREATE)
    @ApiCreateBrand()
    @Post()
    create(@Body() dto: BrandDto) {
        return this.brands.upsert(dto);
    }

    @Permissions(P.BRAND_UPDATE)
    @ApiUpdateBrand()
    @Put(":id")
    update(@Param("id", ParseBigIntPipe) id: bigint, @Body() dto: BrandDto) {
        return this.brands.upsert(dto, id);
    }

    // Must stay ABOVE ":id/status", otherwise "bulk" is parsed as an id.
    @Permissions(P.BRAND_UPDATE)
    @ApiBulkSetBrandStatus()
    @Patch("bulk/status")
    bulkSetStatus(@Body() dto: BrandBulkStatusDto) {
        return this.brands.bulkSetStatus(dto);
    }

    @Permissions(P.BRAND_UPDATE)
    @ApiSetBrandStatus()
    @Patch(":id/status")
    setStatus(
        @Param("id", ParseBigIntPipe) id: bigint,
        @Body() dto: BrandStatusDto,
    ) {
        return this.brands.setStatus(id, dto);
    }

    @Permissions(P.BRAND_DELETE)
    @ApiDeleteBrand()
    @Delete(":id")
    remove(@Param("id", ParseBigIntPipe) id: bigint) {
        return this.brands.remove(id);
    }
}
