import { RenderContext } from "@modules/sdui/render/render.types";

/** Render context of an admin preview: chosen store / customer / segment / time, newest app by default. */
export const previewContext = (
    dto: {
        storeId: number;
        userId?: number;
        segment?: "GUEST" | "NEW_CUSTOMER" | "REPEAT_CUSTOMER";
        lang?: string;
        platform?: "android" | "ios" | "web";
        appVersion?: string;
        at?: Date;
    },
    lang: string,
): RenderContext => ({
    storeId: BigInt(dto.storeId),
    userId: dto.userId ? BigInt(dto.userId) : null,
    deviceId: null,
    platform: dto.platform ?? "android",
    appVersion: dto.appVersion ?? "99.0.0",
    lang: dto.lang ?? lang,
    ...(dto.segment && { segments: [dto.segment] }),
    ...(dto.at && { now: dto.at }),
});
