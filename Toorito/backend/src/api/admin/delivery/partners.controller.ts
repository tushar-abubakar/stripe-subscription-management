import { P } from "@common/authorization/permissions";
import { Permissions } from "@common/decorators/auth.decorator";
import { ListResponseDto } from "@common/dto/list-response.dto";
import { ParseBigIntPipe } from "@core/http/pipes/parse-bigint.pipe";
import {
    AdminDeliveryPartnerQuery,
    RecentActivityQuery,
} from "../dashboard/dashboard.dto";
import { AdminService } from "@modules/admin/admin.service";
import { SetStatusDto } from "../users/users.dto";
import { Body, Get, Param, Patch, Query } from "@nestjs/common";
import { ApiOkResponse } from "@nestjs/swagger";
import { AdminController } from "../admin-controller.decorator";

@AdminController("delivery", "Delivery")
export class AdminDeliveryPartnersController {
    constructor(private readonly admin: AdminService) {}

    @Permissions(P.DELIVERY_ASSIGN)
    @ApiOkResponse({ type: ListResponseDto })
    @Get("partners")
    partners(@Query() query: AdminDeliveryPartnerQuery) {
        return this.admin.deliveryPartners(query);
    }

    @Permissions(P.DELIVERY_ASSIGN)
    @ApiOkResponse({ type: ListResponseDto })
    @Get("live")
    live() {
        return this.admin.deliveryLive();
    }

    @Permissions(P.DELIVERY_ASSIGN)
    @Patch("partners/:id/status")
    partnerStatus(
        @Param("id", ParseBigIntPipe) id: bigint,
        @Body() dto: SetStatusDto,
    ) {
        return this.admin.setPartnerStatus(id, dto.status, dto.reason);
    }

    @Permissions(P.DELIVERY_ASSIGN)
    @ApiOkResponse({ type: ListResponseDto })
    @Get("partners/:id/orders")
    partnerOrders(
        @Param("id", ParseBigIntPipe) id: bigint,
        @Query() query: RecentActivityQuery,
    ) {
        return this.admin.partnerOrders(id, query);
    }
}
