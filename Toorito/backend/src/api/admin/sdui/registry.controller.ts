import { P } from "@common/authorization/permissions";
import { Permissions } from "@common/decorators/auth.decorator";
import { RenderService } from "@modules/sdui/render/render.service";
import { COMPONENTS } from "@modules/sdui/schema/component.registry";
import {
    PLATFORMS,
    SDUI_LIMITS,
    SDUI_SCHEMA_VERSION,
    SEGMENTS,
    WEEKDAYS,
} from "@modules/sdui/schema/contract";
import {
    ACTIONS,
    CONDITIONS_SCHEMA,
    GROUP_ITEMS_SCHEMA,
    GROUP_LANDING_SCHEMA,
    GROUP_MEDIA_SCHEMA,
    GROUP_RULE_SCHEMA,
    GROUP_SCHEDULE_SCHEMA,
    HEADER_SCHEMA,
    LAYOUT_SCHEMA,
    SOURCES,
    STYLE_SCHEMA,
    THEME_SCHEMA,
    VISIBILITY_SCHEMA,
} from "@modules/sdui/schema/definitions";
import { checksum } from "@modules/sdui/sdui.util";
import { Body, Get, HttpCode, Post, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import { I18nLang } from "nestjs-i18n";
import { sendCached } from "../../http-cache.util";
import { AdminController } from "../admin-controller.decorator";
import { previewContext } from "./preview-context";
import { DataPreviewDto } from "./sdui.dto";
import { ApiComponents, ApiDataPreview } from "./sdui.swagger";

const REGISTRY = {
    schemaVersion: SDUI_SCHEMA_VERSION,
    limits: SDUI_LIMITS,
    platforms: PLATFORMS,
    segments: SEGMENTS,
    weekdays: WEEKDAYS,
    components: COMPONENTS,
    blocks: {
        header: HEADER_SCHEMA,
        layout: LAYOUT_SCHEMA,
        style: STYLE_SCHEMA,
        visibility: VISIBILITY_SCHEMA,
    },
    actions: ACTIONS,
    sources: SOURCES,
    conditionsSchema: CONDITIONS_SCHEMA,
    group: {
        items: GROUP_ITEMS_SCHEMA,
        rule: GROUP_RULE_SCHEMA,
        schedule: GROUP_SCHEDULE_SCHEMA,
        media: GROUP_MEDIA_SCHEMA,
        landing: GROUP_LANDING_SCHEMA,
    },
    themeSchema: THEME_SCHEMA,
};
/** Static, so built once; the designer caches it by `registryChecksum`. */
const REGISTRY_CHECKSUM = checksum(REGISTRY).slice(0, 16);
const REGISTRY_RESPONSE = { ...REGISTRY, registryChecksum: REGISTRY_CHECKSUM };
const REGISTRY_ETAG = `"${REGISTRY_CHECKSUM}"`;

/** What the designer's palette and inspector forms are built from, plus "test this source". */
@Permissions(P.SDUI_READ)
@AdminController("sdui", "SDUI Library")
export class AdminSduiRegistryController {
    constructor(private readonly render: RenderService) {}

    /** Changes only with a deploy: ETag = checksum, the panel revalidates hourly. */
    @ApiComponents()
    @Get("components")
    components(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
        return sendCached(
            req,
            res,
            { body: REGISTRY_RESPONSE, etag: REGISTRY_ETAG, ttlSec: 3600 },
            { swr: 86400, vary: ["Authorization"] },
        );
    }

    @ApiDataPreview()
    @Post("data-preview")
    @HttpCode(200)
    dataPreview(@Body() dto: DataPreviewDto, @I18nLang() lang: string) {
        return this.render.dataPreview(dto.source, previewContext(dto, lang), {
            entity: dto.entity,
            cursor: dto.cursor,
        });
    }
}
