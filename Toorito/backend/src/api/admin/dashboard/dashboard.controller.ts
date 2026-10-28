import { P } from "@common/authorization/permissions";
import { Permissions } from "@common/decorators/auth.decorator";
import { ListResponseDto } from "@common/dto/list-response.dto";
import { DashboardRangeQuery, RecentActivityQuery } from "./dashboard.dto";
import { AdminService } from "@modules/admin/admin.service";
import { Get, Query } from "@nestjs/common";
import { ApiOkResponse } from "@nestjs/swagger";
import { AdminController } from "../admin-controller.decorator";

@AdminController("", "Dashboard")
export class AdminDashboardController {
    constructor(private readonly admin: AdminService) {}

    @Permissions(P.ORDER_READ)
    @Get("dashboard/summary")
    summary() {
        return this.admin.dashboardSummary();
    }

    @Permissions(P.ORDER_READ)
    @Get("dashboard/sales")
    sales(@Query() query: DashboardRangeQuery) {
        return this.admin.salesSeries(query);
    }

    @Permissions(P.ORDER_READ)
    @ApiOkResponse({ type: ListResponseDto })
    @Get("activity/recent")
    recentActivity(@Query() query: RecentActivityQuery) {
        return this.admin.recentActivity(query);
    }
}
