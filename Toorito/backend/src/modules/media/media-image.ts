import {
    ImageProfileConfig,
    ImageVariantConfig,
} from "@config/mediaProfile.const";
import { minDimensions } from "@modules/media/media.config";
import { MediaRuleError } from "@modules/media/media.utils";
import sharp, { type Metadata } from "sharp";

const MAX_PIXELS = 100_000_000; // decompression-bomb guard
const opts = { failOn: "error" as const, limitInputPixels: MAX_PIXELS };
const TRANSPARENT = { r: 0, g: 0, b: 0, alpha: 0 };

/** Validates decodability + minimum dimensions (after EXIF rotation). profile=null → no minimum (KYC). */
export async function inspectImage(
    buffer: Buffer,
    profile: ImageProfileConfig | null,
) {
    let meta: Metadata;
    try {
        meta = await sharp(buffer, opts).metadata();
    } catch {
        throw new MediaRuleError("media.image.invalid");
    }
    if (!meta.width || !meta.height)
        throw new MediaRuleError("media.image.invalid");
    const swap = (meta.orientation ?? 1) >= 5;
    const width = swap ? meta.height : meta.width;
    const height = swap ? meta.width : meta.height;
    const min = minDimensions(profile);
    if (min && (width < min.width || height < min.height)) {
        throw new MediaRuleError("media.image.tooSmall", {
            minWidth: min.width,
            minHeight: min.height,
            width,
            height,
        });
    }
    return { width, height };
}

const render = async (buffer: Buffer, v: ImageVariantConfig) => {
    try {
        const { data, info } = await sharp(buffer, opts)
            .rotate() // apply EXIF orientation
            .resize(v.width, v.height, {
                fit: v.fit,
                position: "centre",
                background: TRANSPARENT,
                withoutEnlargement: v.fit === "inside",
            })
            .webp({ lossless: true, effort: 4 })
            .toBuffer({ resolveWithObject: true });
        return { data, width: info.width, height: info.height };
    } catch {
        throw new MediaRuleError("media.image.invalid");
    }
};

export async function renderVariants(
    buffer: Buffer,
    profile: ImageProfileConfig,
) {
    const [master, thumb] = await Promise.all([
        render(buffer, profile.master),
        render(buffer, profile.thumbnail),
    ]);
    return { master, thumb };
}
