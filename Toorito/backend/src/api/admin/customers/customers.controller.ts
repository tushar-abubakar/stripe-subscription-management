import { P } from "@common/authorization/permissions";
import { Permissions } from "@common/decorators/auth.decorator";
import { ListResponseDto } from "@common/dto/list-response.dto";
import { ParseBigIntPipe } from "@core/http/pipes/parse-bigint.pipe";
import {
    AdminCustomerQuery,
    RecentActivityQuery,
} from "../dashboard/dashboard.dto";
import { AdminService } from "@modules/admin/admin.service";
import { Get, Param, Query } from "@nestjs/common";
import { ApiOkResponse } from "@nestjs/swagger";
import { AdminController } from "../admin-controller.decorator";

@AdminController("customers", "Customers")
export class AdminCustomersController {
    constructor(private readonly admin: AdminService) {}

    @Permissions(P.USER_READ)
    @ApiOkResponse({ type: ListResponseDto })
    @Get()
    customers(@Query() query: AdminCustomerQuery) {
        return this.admin.customers(query);
    }

    @Permissions(P.USER_READ)
    @Get(":id")
    customer(@Param("id", ParseBigIntPipe) id: bigint) {
        return this.admin.customer(id);
    }

    @Permissions(P.USER_READ)
    @ApiOkResponse({ type: ListResponseDto })
    @Get(":id/orders")
    customerOrders(
        @Param("id", ParseBigIntPipe) id: bigint,
        @Query() query: RecentActivityQuery,
    ) {
        return this.admin.customerOrders(id, query);
    }
}
