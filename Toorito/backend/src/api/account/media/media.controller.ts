import { CurrentUser, Roles } from "@common/decorators/auth.decorator";
import { AuthUser } from "@common/types/auth.type";
import { ParseBigIntPipe } from "@core/http/pipes/parse-bigint.pipe";
import * as Docs from "../../admin/media/media.swagger";
import { MediaFileInterceptor } from "./media-file.interceptor";
import { MediaUploadExceptionFilter } from "./media-upload.filter";
import { InitUploadDto, UploadMediaDto } from "../../admin/media/media.dto";
import {
    MediaService,
    type UploadedFile as MediaUpload,
} from "@modules/media/media.service";
import {
    Body,
    Get,
    Param,
    Post,
    Put,
    Query,
    Req,
    Res,
    UploadedFile,
    UseFilters,
    UseInterceptors,
} from "@nestjs/common";
import { UserRole } from "@prisma-client/enums";
import type { Request, Response } from "express";
import { AccountController } from "../account-controller.decorator";

export const ALL_ROLES = Object.values(UserRole);

/**
 * Upload flow: POST /uploads → PUT /uploads/:id/content (or signed URL) → POST /uploads/:id/complete → poll GET /:id/status.
 * Fixed routes (purposes, summary, me/avatar) are declared before ":id" routes.
 */
@AccountController("media", "Uploads")
export class AccountMediaController {
    constructor(private readonly media: MediaService) {}

    /* ── upload flow ── */
    @Post("uploads")
    @Docs.MediaInitUploadDocs()
    initUpload(@Body() dto: InitUploadDto, @CurrentUser() user: AuthUser) {
        return this.media.initUpload(dto, user);
    }

    @Put("uploads/:id/content")
    @Docs.MediaUploadContentDocs()
    @UseFilters(MediaUploadExceptionFilter)
    @UseInterceptors(MediaFileInterceptor)
    uploadContent(
        @Param("id", ParseBigIntPipe) id: bigint,
        @UploadedFile() file: MediaUpload,
        @CurrentUser() user: AuthUser,
    ) {
        return this.media.receiveContent(id, file, user);
    }

    @Post("uploads/:id/complete")
    @Docs.MediaCompleteUploadDocs()
    complete(
        @Param("id", ParseBigIntPipe) id: bigint,
        @CurrentUser() user: AuthUser,
    ) {
        return this.media.complete(id, user);
    }

    @Post()
    @Docs.MediaOneShotUploadDocs()
    @UseFilters(MediaUploadExceptionFilter)
    @UseInterceptors(MediaFileInterceptor)
    upload(
        @UploadedFile() file: MediaUpload,
        @Body() dto: UploadMediaDto,
        @CurrentUser() user: AuthUser,
    ) {
        return this.media.upload(file, dto, user);
    }

    /* ── fixed routes ── */
    @Roles(...ALL_ROLES)
    @Get("purposes")
    @Docs.MediaPurposesDocs()
    purposes(@CurrentUser() user: AuthUser) {
        return {
            purposes: this.media.allowedPurposes(user),
            matrix: this.media.purposeMatrix(),
        };
    }

    // Avatars are uploaded / removed only through PUT / DELETE /account/avatar (one per user).

    /* ── per-item ── */
    @Get(":id/status")
    @Docs.MediaStatusDocs()
    status(
        @Param("id", ParseBigIntPipe) id: bigint,
        @CurrentUser() user: AuthUser,
    ) {
        return this.media.status(id, user);
    }

    @Post(":id/retry")
    @Docs.MediaRetryDocs()
    retry(
        @Param("id", ParseBigIntPipe) id: bigint,
        @CurrentUser() user: AuthUser,
    ) {
        return this.media.retry(id, user);
    }

    /** Streams master/thumb with Range + ETag; public remote files redirect to the CDN. Private: owner or purpose readers. */
    @Get(":id/file")
    @Docs.MediaFileDocs()
    async file(
        @Param("id", ParseBigIntPipe) id: bigint,
        @CurrentUser() user: AuthUser,
        @Req() req: Request,
        @Res() res: Response,
        @Query("variant") variant?: string,
        @Query("size") size?: string,
    ) {
        const v =
            variant === "thumb" || size === "thumbnail" ? "thumb" : "master";
        const r = await this.media.serve(id, user, v, {
            range: req.headers.range,
            ifNoneMatch: req.headers["if-none-match"],
        });
        for (const [k, val] of Object.entries(r.headers)) res.setHeader(k, val);
        if (r.redirect) return res.redirect(r.status, r.redirect);
        res.status(r.status);
        if (!r.stream) return res.end();
        r.stream.on("error", () => res.destroy());
        r.stream.pipe(res);
    }
}
