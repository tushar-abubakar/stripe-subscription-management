import { AppConfig } from "@config/config.type";
import { ImageProfileConfig } from "@config/mediaProfile.const";
import { PrismaService } from "@core/database/prisma.service";
import { BadRequestException, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { MediaPurpose, MediaType } from "@prisma-client/client";
import { I18nService } from "nestjs-i18n";

export type CatalogImageCheck = {
    id?: number | bigint | null;
    purpose: Extract<
        MediaPurpose,
        | "PRODUCT"
        | "CATEGORY"
        | "CATEGORY_BANNER"
        | "BRAND"
        | "BRAND_BANNER"
        | "OPTIONVALUE"
        | "STORE"
        | "BUNDLE"
        | "AVATAR"
    >;
    profile: { width: number; height: number };
};

/**
 * Shared by category / brand / product services: verifies that referenced
 * media exists, is an image, has the right purpose and exact master dimensions.
 */
@Injectable()
export class CatalogMediaValidator {
    readonly profiles: Partial<Record<MediaPurpose, ImageProfileConfig>>;

    constructor(
        private readonly prisma: PrismaService,
        private readonly i18n: I18nService,
        config: ConfigService,
    ) {
        const media = config.getOrThrow<AppConfig["media"]>("media");
        const purposes = media.purposes;

        this.profiles = {
            PRODUCT: purposes.PRODUCT.image?.profiles.image,
            CATEGORY: purposes.CATEGORY.image?.profiles.icon,
            CATEGORY_BANNER: purposes.CATEGORY.image?.profiles.banner,
            BRAND: purposes.BRAND.image?.profiles.logo,
            BRAND_BANNER: purposes.BRAND.image?.profiles.banner,
            OPTIONVALUE: purposes.OPTIONVALUE.image?.profiles.image,
            STORE: purposes.STORE.image?.profiles.logo,
            BUNDLE: purposes.BUNDLE.image?.profiles.image,
            AVATAR: purposes.AVATAR.image?.profiles.image,
        };
    }

    async assertImages(items: CatalogImageCheck[]) {
        const toCheck = items.filter(
            (item): item is CatalogImageCheck & { id: number | bigint } =>
                item.id != null,
        );

        if (!toCheck.length) return;

        const ids = [...new Set(toCheck.map((item) => item.id))];

        const media = await this.prisma.mediaFile.findMany({
            where: {
                id: { in: ids.map(BigInt) },
                deletedAt: null,
            },
            select: {
                id: true,
                purpose: true,
                type: true,
                width: true,
                height: true,
            },
        });

        const byId = new Map(media.map((m) => [m.id.toString(), m]));

        for (const item of toCheck) {
            const file = byId.get(item.id.toString());

            if (!file) {
                throw new BadRequestException(
                    this.i18n.translate("catalog.media.notFound"),
                );
            }

            const expected = item.profile;

            if (
                file.purpose !== item.purpose ||
                file.type !== MediaType.IMAGE ||
                file.width !== expected.width ||
                file.height !== expected.height
            ) {
                throw new BadRequestException(
                    this.i18n.translate("catalog.media.invalidDimensions", {
                        args: {
                            purpose: item.purpose,
                            width: expected.width,
                            height: expected.height,
                        },
                    }),
                );
            }
        }
    }
}
