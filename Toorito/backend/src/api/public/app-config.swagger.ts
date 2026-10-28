import {
    PublicAppConfigResponseDto,
    AdminAppConfigResponseDto,
    ConfigErrorResponseDto,
    StoreAppConfigResponseDto,
    DeliveryAppConfigResponseDto,
} from "./app-config.dto";
import { applyDecorators } from "@nestjs/common";
import {
    ApiOperation,
    ApiOkResponse,
    ApiInternalServerErrorResponse,
    ApiUnauthorizedResponse,
    ApiForbiddenResponse,
} from "@nestjs/swagger";

/**
 * Swagger examples for the application configuration endpoints.
 *
 * Values are representative examples; the actual response is derived from
 * the server's runtime configuration and supported enums.
 */
export const APP_CONFIG_SWAGGER_EXAMPLES = {
    public: {
        app: {
            name: "QC Backend",
            timezone: "Asia/Dhaka",
        },
        localization: {
            defaultLanguage: "en",
            languages: ["en", "hi", "pa"],
            rtl: [false, false, false],
        },
        currency: {
            code: "BDT",
            symbol: "৳",
            fractionDigits: 2,
        },
        phone: {
            allowedCountries: ["BD"],
        },
        media: {
            purposes: {
                PRODUCT: {
                    image: {
                        profiles: {
                            image: {
                                master: {
                                    width: 1000,
                                    height: 1000,
                                    fit: "contain",
                                },
                                thumbnail: {
                                    width: 512,
                                    height: 512,
                                    fit: "contain",
                                },
                            },
                        },
                    },
                    video: {
                        maxDurationSeconds: 30,
                        maxBytes: 52428800,
                    },
                    audio: {
                        maxDurationSeconds: 60,
                        maxBytes: 10485760,
                    },
                },
                CATEGORY: {
                    image: {
                        profiles: {
                            icon: {
                                master: {
                                    width: 720,
                                    height: 864,
                                    fit: "contain",
                                },
                                thumbnail: {
                                    width: 360,
                                    height: 432,
                                    fit: "contain",
                                },
                            },
                            banner: {
                                master: {
                                    width: 720,
                                    height: 432,
                                    fit: "cover",
                                },
                                thumbnail: {
                                    width: 500,
                                    height: 300,
                                    fit: "cover",
                                },
                            },
                        },
                    },
                },
                BRAND: {
                    image: {
                        profiles: {
                            logo: {
                                master: {
                                    width: 720,
                                    height: 864,
                                    fit: "contain",
                                },
                                thumbnail: {
                                    width: 360,
                                    height: 432,
                                    fit: "contain",
                                },
                            },
                            banner: {
                                master: {
                                    width: 720,
                                    height: 432,
                                    fit: "cover",
                                },
                                thumbnail: {
                                    width: 500,
                                    height: 300,
                                    fit: "cover",
                                },
                            },
                        },
                    },
                },
                OPTIONVALUE: {
                    image: {
                        profiles: {
                            image: {
                                master: {
                                    width: 256,
                                    height: 256,
                                    fit: "contain",
                                },
                                thumbnail: {
                                    width: 128,
                                    height: 128,
                                    fit: "contain",
                                },
                            },
                        },
                    },
                },
                STORE: {
                    image: {
                        profiles: {
                            logo: {
                                master: {
                                    width: 512,
                                    height: 512,
                                    fit: "contain",
                                },
                                thumbnail: {
                                    width: 200,
                                    height: 200,
                                    fit: "contain",
                                },
                            },
                            banner: {
                                master: {
                                    width: 1200,
                                    height: 400,
                                    fit: "cover",
                                },
                                thumbnail: {
                                    width: 600,
                                    height: 200,
                                    fit: "cover",
                                },
                            },
                        },
                    },
                },
                BUNDLE: {
                    image: {
                        profiles: {
                            image: {
                                master: {
                                    width: 1000,
                                    height: 1000,
                                    fit: "contain",
                                },
                                thumbnail: {
                                    width: 512,
                                    height: 512,
                                    fit: "contain",
                                },
                            },
                        },
                    },
                },
                AVATAR: {
                    image: {
                        profiles: {
                            image: {
                                master: {
                                    width: 512,
                                    height: 512,
                                    fit: "cover",
                                },
                                thumbnail: {
                                    width: 200,
                                    height: 200,
                                    fit: "cover",
                                },
                            },
                        },
                    },
                },
                DELIVERY_PROOF: {
                    image: {
                        profiles: {
                            image: {
                                master: {
                                    width: 1600,
                                    height: 1600,
                                    fit: "inside",
                                },
                                thumbnail: {
                                    width: 400,
                                    height: 400,
                                    fit: "inside",
                                },
                            },
                        },
                    },
                },
                SUPPORT: {
                    image: {
                        profiles: {
                            image: {
                                master: {
                                    width: 1600,
                                    height: 1600,
                                    fit: "inside",
                                },
                                thumbnail: {
                                    width: 400,
                                    height: 400,
                                    fit: "inside",
                                },
                            },
                        },
                    },
                    video: {
                        maxDurationSeconds: 120,
                        maxBytes: 104857600,
                    },
                    audio: {
                        maxDurationSeconds: 60,
                        maxBytes: 10485760,
                    },
                },
                OTHER: {
                    image: {
                        profiles: {
                            image: {
                                master: {
                                    width: 1200,
                                    height: 1200,
                                    fit: "inside",
                                },
                                thumbnail: {
                                    width: 300,
                                    height: 300,
                                    fit: "inside",
                                },
                            },
                        },
                    },
                },
                KYC: {},
            },
            maxImageBytes: 10485760,
            maxVideoBytes: 104857600,
            maxAudioBytes: 52428800,
            maxDocumentBytes: 15728640,
        },
        product: {
            minimumVariants: 1,
            categoryRequired: true,
        },
    },
    admin: {
        audience: "ADMIN",
        roles: [
            "CUSTOMER",
            "DELIVERY_PARTNER",
            "STORE_STAFF",
            "STORE_MANAGER",
            "ADMIN",
            "SUPER_ADMIN",
        ],
        cache: {
            ttlSec: {
                catalog: 600,
                product: 300,
                permissions: 300,
                account: 60,
                storeGeo: 300,
            },
            lease: { leaseMs: 5000, pollMs: 50, maxPolls: 60 },
        },
        media: {
            provider: "LOCAL",
            bucket: "",
            uploadUrlTtlSec: 900,
            text: { titleMaxLen: 191, altMaxLen: 255 },
        },
        catalog: {
            productStatuses: ["DRAFT", "PUBLISHED", "ARCHIVED"],
            supportsProductRestore: true,
            supportsOptionTypes: true,
            minimumCategories: 1,
        },
    },
    store: {
        audience: "STORE",
        permissions: {
            canManageGlobalProducts: false,
            canManageInventory: true,
            canManageStorePricing: true,
        },
    },
    delivery: {
        audience: "DELIVERY_PARTNER",
        tracking: { enabled: true },
    },
    unauthorized: {
        statusCode: 401,
        message: "Unauthorized",
    },
    forbidden: {
        statusCode: 403,
        message: "Forbidden resource",
    },
    internalServerError: {
        statusCode: 500,
        message: "Internal server error",
    },
} as const;


// ---------------------------------------------------------------------
// Endpoint docs (GET /public/config, /admin/config, /store/config, /partner/config)
// ---------------------------------------------------------------------

export const ApiPublicAppConfig = () =>
    applyDecorators(
        ApiOperation({
            operationId: "getPublicAppConfig",
            summary: "Get public application configuration",
            description:
                "Returns non-sensitive runtime configuration for client initialization.",
        }),
        ApiOkResponse({
            type: PublicAppConfigResponseDto,
            description: "Public application configuration",
            examples: {
                success: {
                    summary: "Successful response",
                    value: APP_CONFIG_SWAGGER_EXAMPLES.public,
                },
            },
        }),
        ApiInternalServerErrorResponse({
            description: "The application configuration could not be loaded",
            schema: {
                example: APP_CONFIG_SWAGGER_EXAMPLES.internalServerError,
            },
        }),
    );

export const ApiAdminAppConfig = () =>
    applyDecorators(
        ApiOperation({
            operationId: "getAdminAppConfig",
            summary: "Get admin application configuration",
            description:
                "Requires a Bearer access token and the ADMIN or SUPER_ADMIN role.",
        }),
        ApiOkResponse({
            type: AdminAppConfigResponseDto,
            description: "Public configuration plus admin-specific settings",
            examples: {
                success: {
                    summary: "Successful response",
                    value: {
                        ...APP_CONFIG_SWAGGER_EXAMPLES.public,
                        audience: APP_CONFIG_SWAGGER_EXAMPLES.admin.audience,
                        roles: APP_CONFIG_SWAGGER_EXAMPLES.admin.roles,
                        cache: APP_CONFIG_SWAGGER_EXAMPLES.admin.cache,
                        media: {
                            ...APP_CONFIG_SWAGGER_EXAMPLES.public.media,
                            ...APP_CONFIG_SWAGGER_EXAMPLES.admin.media,
                        },
                        catalog: APP_CONFIG_SWAGGER_EXAMPLES.admin.catalog,
                    },
                },
            },
        }),
        ApiUnauthorizedResponse({
            type: ConfigErrorResponseDto,
            description: "Missing, invalid, or expired access token",
            schema: {
                example: APP_CONFIG_SWAGGER_EXAMPLES.unauthorized,
            },
        }),
        ApiForbiddenResponse({
            type: ConfigErrorResponseDto,
            description: "Authenticated user does not have an admin role",
            schema: {
                example: APP_CONFIG_SWAGGER_EXAMPLES.forbidden,
            },
        }),
        ApiInternalServerErrorResponse({
            description: "The application configuration could not be loaded",
            schema: {
                example: APP_CONFIG_SWAGGER_EXAMPLES.internalServerError,
            },
        }),
    );

export const ApiStoreAppConfig = () =>
    applyDecorators(
        ApiOperation({
            operationId: "getStoreAppConfig",
            summary: "Get store application configuration",
            description:
                "Requires a Bearer access token and the STORE_MANAGER or STORE_STAFF role.",
        }),
        ApiOkResponse({
            type: StoreAppConfigResponseDto,
            description: "Public configuration plus store-specific settings",
            examples: {
                success: {
                    summary: "Successful response",
                    value: {
                        ...APP_CONFIG_SWAGGER_EXAMPLES.public,
                        ...APP_CONFIG_SWAGGER_EXAMPLES.store,
                    },
                },
            },
        }),
        ApiUnauthorizedResponse({
            type: ConfigErrorResponseDto,
            description: "Missing, invalid, or expired access token",
            schema: {
                example: APP_CONFIG_SWAGGER_EXAMPLES.unauthorized,
            },
        }),
        ApiForbiddenResponse({
            type: ConfigErrorResponseDto,
            description: "Authenticated user does not have a store role",
            schema: {
                example: APP_CONFIG_SWAGGER_EXAMPLES.forbidden,
            },
        }),
        ApiInternalServerErrorResponse({
            description: "The application configuration could not be loaded",
            schema: {
                example: APP_CONFIG_SWAGGER_EXAMPLES.internalServerError,
            },
        }),
    );

export const ApiPartnerAppConfig = () =>
    applyDecorators(
        ApiOperation({
            operationId: "getDeliveryAppConfig",
            summary: "Get delivery partner application configuration",
            description:
                "Requires a Bearer access token and the DELIVERY_PARTNER role.",
        }),
        ApiOkResponse({
            type: DeliveryAppConfigResponseDto,
            description: "Delivery partner application configuration",
            examples: {
                success: {
                    summary: "Successful response",
                    value: {
                        app: APP_CONFIG_SWAGGER_EXAMPLES.public.app,
                        localization: {
                            defaultLanguage:
                                APP_CONFIG_SWAGGER_EXAMPLES.public.localization
                                    .defaultLanguage,
                            languages:
                                APP_CONFIG_SWAGGER_EXAMPLES.public.localization
                                    .languages,
                        },
                        ...APP_CONFIG_SWAGGER_EXAMPLES.delivery,
                    },
                },
            },
        }),
        ApiUnauthorizedResponse({
            type: ConfigErrorResponseDto,
            description: "Missing, invalid, or expired access token",
            schema: {
                example: APP_CONFIG_SWAGGER_EXAMPLES.unauthorized,
            },
        }),
        ApiForbiddenResponse({
            type: ConfigErrorResponseDto,
            description: "Authenticated user is not a delivery partner",
            schema: {
                example: APP_CONFIG_SWAGGER_EXAMPLES.forbidden,
            },
        }),
        ApiInternalServerErrorResponse({
            description: "The application configuration could not be loaded",
            schema: {
                example: APP_CONFIG_SWAGGER_EXAMPLES.internalServerError,
            },
        }),
    );
