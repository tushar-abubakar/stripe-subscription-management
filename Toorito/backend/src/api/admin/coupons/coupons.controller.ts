import { P } from "@common/authorization/permissions";
import { Permissions } from "@common/decorators/auth.decorator";
import { PageQueryDto } from "@common/dto/page-query.dto";
import { ParseBigIntPipe } from "@core/http/pipes/parse-bigint.pipe";
import { Body, Delete, Get, Param, Patch, Post, Query } from "@nestjs/common";
import { AdminController } from "../admin-controller.decorator";
import { CreateCouponDto, UpdateCouponDto } from "./coupons.dto";
import { CouponsService } from "@modules/orders/coupons.service";

@AdminController("coupons", "Coupons")
export class AdminCouponsController {
    constructor(private readonly coupons: CouponsService) {}

    @Permissions(P.COUPON_READ)
    @Get()
    list(@Query() query: PageQueryDto) {
        return this.coupons.list(query);
    }

    @Permissions(P.COUPON_READ)
    @Get(":id")
    get(@Param("id", ParseBigIntPipe) id: bigint) {
        return this.coupons.get(id);
    }

    @Permissions(P.COUPON_WRITE)
    @Post()
    create(@Body() dto: CreateCouponDto) {
        return this.coupons.create(dto);
    }

    @Permissions(P.COUPON_WRITE)
    @Patch(":id")
    update(
        @Param("id", ParseBigIntPipe) id: bigint,
        @Body() dto: UpdateCouponDto,
    ) {
        return this.coupons.update(id, dto);
    }

    @Permissions(P.COUPON_WRITE)
    @Delete(":id")
    deactivate(@Param("id", ParseBigIntPipe) id: bigint) {
        return this.coupons.deactivate(id);
    }
}
