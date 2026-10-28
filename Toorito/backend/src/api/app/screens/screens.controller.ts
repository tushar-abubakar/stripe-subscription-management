import { CurrentUser } from "@common/decorators/auth.decorator";
import { AuthUser } from "@common/types/auth.type";
import { RenderService } from "@modules/sdui/render/render.service";
import { EntityType, RenderContext } from "@modules/sdui/render/render.types";
import {
    BadRequestException,
    Get,
    Headers,
    Param,
    Query,
    Req,
    Res,
} from "@nestjs/common";
import { UserRole } from "@prisma-client/enums";
import type { Request, Response } from "express";
import { I18nLang } from "nestjs-i18n";
import { sendCached } from "../../http-cache.util";
import { AppController } from "../app-controller.decorator";
import {
    AppContextQuery,
    LandingItemsQuery,
    LandingQuery,
    ScreenQuery,
    SectionQuery,
} from "./screens.dto";
import {
    ApiLanding,
    ApiLandingItems,
    ApiPreview,
    ApiPreviewSection,
    ApiScreen,
    ApiScreenHeaders,
    ApiSection,
    ApiShell,
} from "./screens.swagger";

const ENTITY_TYPES: EntityType[] = ["group", "category", "brand"];

const ctxOf = (
    q: AppContextQuery,
    lang: string,
    user?: AuthUser,
    deviceId?: string,
): RenderContext => ({
    storeId: q.storeId ? BigInt(q.storeId) : null,
    platform: q.platform ?? "android",
    appVersion: q.appVersion ?? "1.0.0",
    lang,
    userId: user?.role === UserRole.CUSTOMER ? user.id : null,
    deviceId: deviceId?.slice(0, 64) ?? null,
});

const entityType = (t: string): EntityType => {
    if (!ENTITY_TYPES.includes(t as EntityType))
        throw new BadRequestException({
            message: "type must be group, category or brand",
            code: "INVALID_TYPE",
        });
    return t as EntityType;
};

const landingQuery = (q: LandingQuery) => ({
    sort: q.sort,
    categoryId: q.categoryId,
    brandId: q.brandId,
    minPrice: q.minPrice,
    maxPrice: q.maxPrice,
    minDiscountPct: q.minDiscountPct,
});

/** Server-driven screens for the customer app (guests allowed). */
@ApiScreenHeaders()
@AppController("", "Screens")
export class AppScreensController {
    constructor(private readonly render: RenderService) {}

    @ApiShell()
    @Get("shell")
    async shell(
        @Query() q: AppContextQuery,
        @I18nLang() lang: string,
        @Req() req: Request,
        @Res({ passthrough: true }) res: Response,
    ) {
        // Same for everyone with this language / platform / version → shareable (CDN) copy.
        return sendCached(req, res, await this.render.shell(ctxOf(q, lang)), {
            scope: "public",
            swr: 600,
            vary: ["Accept-Language"],
        });
    }

    @ApiScreen()
    @Get("screens/:key")
    async screen(
        @Param("key") key: string,
        @Query() q: ScreenQuery,
        @I18nLang() lang: string,
        @CurrentUser() user: AuthUser | undefined,
        @Headers("x-device-id") deviceId: string | undefined,
        @Req() req: Request,
        @Res({ passthrough: true }) res: Response,
    ) {
        return sendCached(
            req,
            res,
            await this.render.screen(key, ctxOf(q, lang, user, deviceId), q.v),
        );
    }

    @ApiSection()
    @Get("screens/:key/sections/:sectionId")
    async section(
        @Param("key") key: string,
        @Param("sectionId") sectionId: string,
        @Query() q: SectionQuery,
        @I18nLang() lang: string,
        @CurrentUser() user: AuthUser | undefined,
        @Headers("x-device-id") deviceId: string | undefined,
        @Req() req: Request,
        @Res({ passthrough: true }) res: Response,
    ) {
        const page = await this.render.section(
            key,
            sectionId,
            ctxOf(q, lang, user, deviceId),
            { version: q.v, cursor: q.cursor },
        );
        return sendCached(
            req,
            res,
            { body: page.body, ttlSec: page.ttlSec },
            { swr: 30 },
        );
    }

    @ApiLanding()
    @Get("landing/:type/:ref")
    async landing(
        @Param("type") type: string,
        @Param("ref") ref: string,
        @Query() q: LandingQuery,
        @I18nLang() lang: string,
        @CurrentUser() user: AuthUser | undefined,
        @Headers("x-device-id") deviceId: string | undefined,
        @Req() req: Request,
        @Res({ passthrough: true }) res: Response,
    ) {
        return sendCached(
            req,
            res,
            await this.render.landing(
                { type: entityType(type), ref },
                ctxOf(q, lang, user, deviceId),
                landingQuery(q),
            ),
        );
    }

    @ApiLandingItems()
    @Get("landing/:type/:ref/items")
    async landingItems(
        @Param("type") type: string,
        @Param("ref") ref: string,
        @Query() q: LandingItemsQuery,
        @I18nLang() lang: string,
        @CurrentUser() user: AuthUser | undefined,
        @Headers("x-device-id") deviceId: string | undefined,
        @Req() req: Request,
        @Res({ passthrough: true }) res: Response,
    ) {
        const page = await this.render.landingItems(
            { type: entityType(type), ref },
            ctxOf(q, lang, user, deviceId),
            landingQuery(q),
            q.cursor,
            q.limit,
        );
        return sendCached(req, res, page, { swr: 30 });
    }

    @ApiPreview()
    @Get("preview/:token")
    async preview(
        @Param("token") token: string,
        @Query() q: AppContextQuery,
        @I18nLang() lang: string,
        @Headers("x-device-id") deviceId: string | undefined,
        @Res({ passthrough: true }) res: Response,
    ) {
        res.setHeader("Cache-Control", "no-store");
        return this.render.previewByToken(
            token,
            ctxOf(q, lang, undefined, deviceId),
        );
    }

    @ApiPreviewSection()
    @Get("preview/:token/sections/:sectionId")
    async previewSection(
        @Param("token") token: string,
        @Param("sectionId") sectionId: string,
        @Query() q: SectionQuery,
        @I18nLang() lang: string,
        @Res({ passthrough: true }) res: Response,
    ) {
        res.setHeader("Cache-Control", "no-store");
        const page = (await this.render.previewByToken(
            token,
            ctxOf(q, lang),
            sectionId,
            q.cursor,
        )) as { body: unknown };
        return page.body;
    }
}
