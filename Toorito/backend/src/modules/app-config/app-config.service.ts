import { AppConfig } from "@config/config.type";
import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ProductStatus, UserRole } from "@prisma-client/enums";

/**
 * Runtime configuration the client apps load at start-up, per audience
 * (public / admin panel / store app / delivery partner app). Only non-sensitive values.
 * HTTP: /public/config, /admin/config, /store/config, /partner/config.
 */
@Injectable()
export class AppConfigService {
    constructor(private readonly config: ConfigService) {}

    /** Non-sensitive runtime configuration for client initialization. */
    publicConfig() {
        const app = this.config.getOrThrow<AppConfig["app"]>("app");
        const i18n = this.config.getOrThrow<AppConfig["i18n"]>("i18n");
        const currency =
            this.config.getOrThrow<AppConfig["currency"]>("currency");
        const media = this.config.getOrThrow<AppConfig["media"]>("media");
        const phone = this.config.getOrThrow<AppConfig["phone"]>("phone");

        const rtlCodes = new Set(["ar", "fa", "he", "ur", "ps"]);

        return {
            app: {
                name: app.name,
                timezone: app.timezone,
            },
            localization: {
                defaultLanguage: i18n.defaultLanguage,
                languages: i18n.languages,
                rtl: i18n.languages.map((code: string) =>
                    rtlCodes.has(code.split("-")[0]),
                ),
            },
            currency,
            phone,
            media: {
                purposes: media.purposes,
                maxImageBytes: media.image.maxBytes,
                maxVideoBytes: media.video.maxBytes,
                maxAudioBytes: media.audio.maxBytes,
                maxDocumentBytes: media.document.maxBytes,
            },
            product: {
                minimumVariants: 1,
                categoryRequired: true,
            },
        };
    }

    /** Public configuration plus admin panel settings (roles, cache, media provider, catalogue rules). */
    adminConfig() {
        const base = this.publicConfig();
        const cache = this.config.getOrThrow<AppConfig["cache"]>("cache");
        const media = this.config.getOrThrow<AppConfig["media"]>("media");

        return {
            ...base,
            audience: "ADMIN",
            roles: Object.values(UserRole),
            cache: {
                ttlSec: cache.ttlSec,
                lease: cache.lease,
            },
            media: {
                ...base.media,
                provider: media.provider,
                bucket: media.bucket,
                uploadUrlTtlSec: media.jobs.uploadUrlTtlSec,
                text: media.text,
            },
            catalog: {
                productStatuses: [
                    ProductStatus.DRAFT,
                    ProductStatus.PUBLISHED,
                    ProductStatus.ARCHIVED,
                ],
                supportsProductRestore: true,
                supportsOptionTypes: true,
                minimumCategories: 1,
            },
        };
    }

    /** Public configuration plus what the store app may do. */
    storeConfig() {
        const base = this.publicConfig();

        return {
            ...base,
            audience: "STORE",
            permissions: {
                canManageGlobalProducts: false,
                canManageInventory: true,
                canManageStorePricing: true,
            },
        };
    }

    /** App, language and tracking settings of the delivery partner app. */
    deliveryConfig() {
        const app = this.config.getOrThrow<AppConfig["app"]>("app");
        const i18n = this.config.getOrThrow<AppConfig["i18n"]>("i18n");

        return {
            app: {
                name: app.name,
                timezone: app.timezone,
            },
            localization: i18n,
            audience: "DELIVERY_PARTNER",
            tracking: {
                enabled: true,
            },
        };
    }
}
