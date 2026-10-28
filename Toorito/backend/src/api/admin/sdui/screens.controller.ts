import { P } from "@common/authorization/permissions";
import { CurrentUser, Permissions } from "@common/decorators/auth.decorator";
import { AuthUser } from "@common/types/auth.type";
import { ParseBigIntPipe } from "@core/http/pipes/parse-bigint.pipe";
import { RenderService } from "@modules/sdui/render/render.service";
import { ScreensService } from "@modules/sdui/screens.service";
import {
    Body,
    Delete,
    Get,
    HttpCode,
    Param,
    ParseIntPipe,
    Patch,
    Post,
    Put,
    Query,
} from "@nestjs/common";
import { I18nLang } from "nestjs-i18n";
import { AdminController } from "../admin-controller.decorator";
import { previewContext } from "./preview-context";
import {
    CreateScreenDto,
    DiffQuery,
    PreviewDto,
    PublishDto,
    RuleDto,
    SaveDraftDto,
    ScreenListQuery,
    UpdateRuleDto,
    UpdateScreenDto,
    ValidateDto,
    VersionListQuery,
} from "./sdui.dto";
import {
    ApiCancelSchedule,
    ApiDiff,
    ApiDiscardDraft,
    ApiMakeLive,
    ApiPreview,
    ApiPublish,
    ApiRestoreDraft,
    ApiRuleCreate,
    ApiRuleDelete,
    ApiRuleUpdate,
    ApiRules,
    ApiSaveDraft,
    ApiScreenCreate,
    ApiScreenDelete,
    ApiScreenGet,
    ApiScreenList,
    ApiScreenUpdate,
    ApiValidate,
    ApiVersionGet,
    ApiVersions,
} from "./sdui.swagger";

/**
 * Screen designer: drafts, publish / schedule / rollback, targeting rules.
 * Read = `sdui.read`, edit drafts = `sdui.manage`, anything customers see = `sdui.publish`.
 */
@Permissions(P.SDUI_READ)
@AdminController("sdui/screens", "SDUI Screens")
export class AdminSduiScreensController {
    constructor(
        private readonly screens: ScreensService,
        private readonly render: RenderService,
    ) {}

    @ApiScreenList()
    @Get()
    list(@Query() q: ScreenListQuery) {
        return this.screens.list(q);
    }

    @Permissions(P.SDUI_MANAGE)
    @ApiScreenCreate()
    @Post()
    @HttpCode(200)
    create(@Body() dto: CreateScreenDto, @CurrentUser() user: AuthUser) {
        const { copyFromScreenId, copyFromVersion, ...rest } = dto;
        return this.screens.create(
            {
                ...rest,
                ...(copyFromScreenId && {
                    copyFrom: {
                        screenId: BigInt(copyFromScreenId),
                        version: copyFromVersion,
                    },
                }),
            },
            user,
        );
    }

    @ApiScreenGet()
    @Get(":id")
    get(@Param("id", ParseBigIntPipe) id: bigint) {
        return this.screens.get(id);
    }

    @Permissions(P.SDUI_MANAGE)
    @ApiScreenUpdate()
    @Patch(":id")
    update(
        @Param("id", ParseBigIntPipe) id: bigint,
        @Body() dto: UpdateScreenDto,
        @CurrentUser() user: AuthUser,
    ) {
        return this.screens.update(id, dto, user);
    }

    @Permissions(P.SDUI_PUBLISH)
    @ApiScreenDelete()
    @Delete(":id")
    remove(
        @Param("id", ParseBigIntPipe) id: bigint,
        @CurrentUser() user: AuthUser,
    ) {
        return this.screens.remove(id, user);
    }

    // ── draft ──

    @Permissions(P.SDUI_MANAGE)
    @ApiSaveDraft()
    @Put(":id/draft")
    saveDraft(
        @Param("id", ParseBigIntPipe) id: bigint,
        @Body() dto: SaveDraftDto,
        @CurrentUser() user: AuthUser,
    ) {
        return this.screens.saveDraft(id, dto, user);
    }

    @Permissions(P.SDUI_MANAGE)
    @ApiDiscardDraft()
    @Post(":id/draft/discard")
    @HttpCode(200)
    discardDraft(
        @Param("id", ParseBigIntPipe) id: bigint,
        @CurrentUser() user: AuthUser,
    ) {
        return this.screens.discardDraft(id, user);
    }

    @ApiValidate()
    @Post(":id/validate")
    @HttpCode(200)
    validate(
        @Param("id", ParseBigIntPipe) id: bigint,
        @Body() dto: ValidateDto,
    ) {
        return this.screens.validate(id, dto?.layout);
    }

    @ApiPreview()
    @Post(":id/preview")
    @HttpCode(200)
    async preview(
        @Param("id", ParseBigIntPipe) id: bigint,
        @Body() dto: PreviewDto,
        @I18nLang() lang: string,
    ) {
        const s = await this.screens.draftOf(id);
        return this.render.preview(
            { key: s.key, kind: s.kind },
            dto.layout ?? s.draftLayout,
            previewContext(dto, lang),
            { entity: dto.entity },
        );
    }

    // ── versions ──

    @Permissions(P.SDUI_PUBLISH)
    @ApiPublish()
    @Post(":id/publish")
    @HttpCode(200)
    publish(
        @Param("id", ParseBigIntPipe) id: bigint,
        @Body() dto: PublishDto,
        @CurrentUser() user: AuthUser,
    ) {
        return this.screens.publish(id, dto, user);
    }

    @ApiVersions()
    @Get(":id/versions")
    versions(
        @Param("id", ParseBigIntPipe) id: bigint,
        @Query() q: VersionListQuery,
    ) {
        return this.screens.versions(id, q);
    }

    @ApiVersionGet()
    @Get(":id/versions/:version")
    version(
        @Param("id", ParseBigIntPipe) id: bigint,
        @Param("version", ParseIntPipe) version: number,
    ) {
        return this.screens.version(id, version);
    }

    @ApiDiff()
    @Get(":id/versions/:version/diff")
    diff(
        @Param("id", ParseBigIntPipe) id: bigint,
        @Param("version", ParseIntPipe) version: number,
        @Query() q: DiffQuery,
    ) {
        const against =
            !q.against || q.against === "live" || q.against === "draft"
                ? ((q.against ?? "live") as "live" | "draft")
                : Number(q.against);
        return this.screens.diff(id, version, against);
    }

    @Permissions(P.SDUI_PUBLISH)
    @ApiMakeLive()
    @Post(":id/versions/:version/make-live")
    @HttpCode(200)
    makeLive(
        @Param("id", ParseBigIntPipe) id: bigint,
        @Param("version", ParseIntPipe) version: number,
        @CurrentUser() user: AuthUser,
    ) {
        return this.screens.makeLive(id, version, user);
    }

    @Permissions(P.SDUI_PUBLISH)
    @ApiCancelSchedule()
    @Post(":id/versions/:version/cancel")
    @HttpCode(200)
    cancel(
        @Param("id", ParseBigIntPipe) id: bigint,
        @Param("version", ParseIntPipe) version: number,
        @CurrentUser() user: AuthUser,
    ) {
        return this.screens.cancelScheduled(id, version, user);
    }

    @Permissions(P.SDUI_MANAGE)
    @ApiRestoreDraft()
    @Post(":id/versions/:version/restore-draft")
    @HttpCode(200)
    restoreDraft(
        @Param("id", ParseBigIntPipe) id: bigint,
        @Param("version", ParseIntPipe) version: number,
        @CurrentUser() user: AuthUser,
    ) {
        return this.screens.restoreToDraft(id, version, user);
    }

    // ── targeting rules (JSON array on the screen) ──

    @ApiRules()
    @Get(":id/rules")
    rules(@Param("id", ParseBigIntPipe) id: bigint) {
        return this.screens.rules(id);
    }

    @Permissions(P.SDUI_PUBLISH)
    @ApiRuleCreate()
    @Post(":id/rules")
    @HttpCode(200)
    createRule(
        @Param("id", ParseBigIntPipe) id: bigint,
        @Body() dto: RuleDto,
        @CurrentUser() user: AuthUser,
    ) {
        return this.screens.createRule(id, dto, user);
    }

    @Permissions(P.SDUI_PUBLISH)
    @ApiRuleUpdate()
    @Patch(":id/rules/:ruleId")
    updateRule(
        @Param("id", ParseBigIntPipe) id: bigint,
        @Param("ruleId") ruleId: string,
        @Body() dto: UpdateRuleDto,
        @CurrentUser() user: AuthUser,
    ) {
        return this.screens.updateRule(id, ruleId, dto, user);
    }

    @Permissions(P.SDUI_PUBLISH)
    @ApiRuleDelete()
    @Delete(":id/rules/:ruleId")
    deleteRule(
        @Param("id", ParseBigIntPipe) id: bigint,
        @Param("ruleId") ruleId: string,
        @CurrentUser() user: AuthUser,
    ) {
        return this.screens.deleteRule(id, ruleId, user);
    }
}
