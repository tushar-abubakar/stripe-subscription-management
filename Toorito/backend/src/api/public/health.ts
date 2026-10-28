import { Get } from "@nestjs/common";
import { ApiOkResponse, ApiOperation } from "@nestjs/swagger";
import { PublicController } from "./public-controller.decorator";

/** Liveness probe for load balancers and uptime checks. */
@PublicController("health", "Health")
export class PublicHealthController {
    @ApiOperation({
        summary: "Liveness probe",
        description:
            "Returns 200 while the process is up. Does not touch the database or Redis.",
    })
    @ApiOkResponse({
        schema: { example: { status: "ok", time: "2026-10-24T18:30:00.000Z" } },
    })
    @Get()
    check() {
        return { status: "ok", time: new Date().toISOString() };
    }
}
