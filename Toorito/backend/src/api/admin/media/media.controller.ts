import { P } from "@common/authorization/permissions";
import { CurrentUser, Permissions } from "@common/decorators/auth.decorator";
import { AuthUser } from "@common/types/auth.type";
import { ParseBigIntPipe } from "@core/http/pipes/parse-bigint.pipe";
import * as Docs from "./media.swagger";
import { MediaFileInterceptor } from "../../account/media/media-file.interceptor";
import { MediaUploadExceptionFilter } from "../../account/media/media-upload.filter";
import {
    MediaListQueryDto,
    MediaSummaryQueryDto,
    UpdateMediaDto,
} from "./media.dto";
import {
    MediaService,
    type UploadedFile as MediaUpload,
} from "@modules/media/media.service";
import {
    Body,
    Delete,
    Get,
    Param,
    Patch,
    Put,
    Query,
    UploadedFile,
    UseFilters,
    UseInterceptors,
} from "@nestjs/common";
import { AdminController } from "../admin-controller.decorator";

/**
 * Upload flow: POST /uploads → PUT /uploads/:id/content (or signed URL) → POST /uploads/:id/complete → poll GET /:id/status.
 * Fixed routes (purposes, summary, me/avatar) are declared before ":id" routes.
 */
@AdminController("media", "Media library")
export class AdminMediaController {
    constructor(private readonly media: MediaService) {}

    @Permissions(P.MEDIA_READ)
    @Get("summary")
    @Docs.MediaSummaryDocs()
    summary(
        @CurrentUser() user: AuthUser,
        @Query() query: MediaSummaryQueryDto,
    ) {
        return this.media.summary(user, query);
    }

    @Permissions(P.MEDIA_READ)
    @Get()
    @Docs.MediaListDocs()
    list(@CurrentUser() user: AuthUser, @Query() query: MediaListQueryDto) {
        return this.media.list(user, query);
    }

    /** Where a file is used. Admins: any; store managers: catalog media + own uploads. */
    @Permissions(P.MEDIA_READ)
    @Get(":id/usage")
    @Docs.MediaUsageDocs()
    usage(
        @Param("id", ParseBigIntPipe) id: bigint,
        @CurrentUser() user: AuthUser,
    ) {
        return this.media.usageOf(id, user);
    }

    /** Details. Admins: any; store managers: catalog media + own uploads. */
    @Permissions(P.MEDIA_READ)
    @Get(":id")
    @Docs.MediaGetDocs()
    get(
        @Param("id", ParseBigIntPipe) id: bigint,
        @CurrentUser() user: AuthUser,
    ) {
        return this.media.get(id, user);
    }

    /** Edit title / alt. Admins: any file; store managers: own uploads only. */
    @Permissions(P.MEDIA_UPLOAD)
    @Patch(":id")
    @Docs.MediaPatchDocs()
    patch(
        @Param("id", ParseBigIntPipe) id: bigint,
        @Body() dto: UpdateMediaDto,
        @CurrentUser() user: AuthUser,
    ) {
        return this.media.patch(id, dto, user);
    }

    /** Replace the bytes. Admins: any file; store managers: own uploads only. */
    @Permissions(P.MEDIA_UPLOAD)
    @Put(":id/file")
    @Docs.MediaReplaceDocs()
    @UseFilters(MediaUploadExceptionFilter)
    @UseInterceptors(MediaFileInterceptor)
    replace(
        @Param("id", ParseBigIntPipe) id: bigint,
        @UploadedFile() file: MediaUpload,
        @CurrentUser() user: AuthUser,
    ) {
        return this.media.replaceFile(id, file, user);
    }

    /** Delete (refused while in use). Admins: any file; store managers: own uploads only. */
    @Permissions(P.MEDIA_UPLOAD)
    @Delete(":id")
    @Docs.MediaDeleteDocs()
    remove(
        @Param("id", ParseBigIntPipe) id: bigint,
        @CurrentUser() user: AuthUser,
    ) {
        return this.media.remove(id, user);
    }
}
