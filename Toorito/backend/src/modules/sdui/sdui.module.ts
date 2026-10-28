import { InventoryModule } from "@modules/inventory/inventory.module";
import { Module } from "@nestjs/common";
import { LayoutValidatorService } from "./layout-validator.service";
import { LibraryService } from "./library.service";
import { SduiConfigService } from "./render/config.service";
import { DataSourcesService } from "./render/data-sources.service";
import { RenderService } from "./render/render.service";
import { ScreensService } from "./screens.service";
import { SduiCache, SduiErrors } from "./sdui.util";

/**
 * Server-driven UI — business logic only (HTTP lives in src/api/admin/sdui and src/api/app/screens):
 * - schema/    JSON contract, component registry, starter layouts (shared with the admin panel and Flutter)
 * - screens    drafts, publish / schedule / rollback, diff, targeting rules
 * - library    saved sections and custom groups
 * - render/    what the app gets: version choice, targeting, visibility & schedules, data sources,
 *              landing pages, preview; two-level cache (memory + Redis) keyed by the SDUI generation
 */
@Module({
    imports: [InventoryModule],
    providers: [
        LayoutValidatorService,
        ScreensService,
        LibraryService,
        SduiConfigService,
        DataSourcesService,
        RenderService,
        SduiCache,
        SduiErrors,
    ],
    exports: [
        LayoutValidatorService,
        ScreensService,
        LibraryService,
        RenderService,
        SduiCache,
    ],
})
export class SduiModule {}
