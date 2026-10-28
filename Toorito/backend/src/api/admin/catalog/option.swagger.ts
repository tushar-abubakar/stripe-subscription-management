import { OptionValueType } from "@prisma-client/enums";

/**
 * Centralized Swagger examples for catalog option endpoints.
 *
 * IDs are strings because JavaScript JSON cannot serialize bigint values.
 */

export const OPTION_SWAGGER_EXAMPLES = {
    group: {
        id: "12",
        code: "COLOR",
        name: {
            en: "Color",
            hi: "रंग",
            pa: "ਰੰਗ",
        },
        valueType: OptionValueType.TEXT,
        isFilterable: true,
        values: [
            {
                id: "101",
                code: "RED",
                label: {
                    en: "Red",
                    hi: "लाल",
                    pa: "ਲਾਲ",
                },
                swatch: "#FF0000",
                imageId: "45",
                imageUrl:
                    "http://localhost:3000/media-public/options/images/red-thumb.webp",
                position: 1,
            },
            {
                id: "102",
                code: "BLUE",
                label: {
                    en: "Blue",
                    hi: "नीला",
                    pa: "ਨੀਲਾ",
                },
                swatch: "#0000FF",
                imageId: null,
                imageUrl: null,
                position: 2,
            },
        ],
    },

    sizeGroup: {
        id: "15",
        code: "SIZE",
        name: {
            en: "Size",
            hi: "आकार",
            pa: "ਆਕਾਰ",
        },
        valueType: OptionValueType.TEXT,
        isFilterable: true,
        values: [],
    },

    createGroupBody: {
        code: "COLOR",
        name: {
            en: "Color",
            hi: "रंग",
            pa: "ਰੰਗ",
        },
        valueType: OptionValueType.TEXT,
        isFilterable: true,
        values: [
            {
                code: "RED",
                label: {
                    en: "Red",
                    hi: "लाल",
                    pa: "ਲਾਲ",
                },
                swatch: "#FF0000",
                imageId: "45",
                position: 1,
            },
            {
                code: "BLUE",
                label: {
                    en: "Blue",
                    hi: "नीला",
                    pa: "ਨੀਲਾ",
                },
                swatch: "#0000FF",
                position: 2,
            },
        ],
    },

    updateGroupBody: {
        name: {
            en: "Product Color",
            hi: "उत्पाद का रंग",
            pa: "ਉਤਪਾਦ ਦਾ ਰੰਗ",
        },
        valueType: OptionValueType.TEXT,
        isFilterable: true,
    },

    createValueBody: {
        code: "RED",
        label: {
            en: "Red",
            hi: "लाल",
            pa: "ਲਾਲ",
        },
        swatch: "#FF0000",
        imageId: "45",
        position: 1,
    },

    updateValueBody: {
        code: "DARK_RED",
        label: {
            en: "Dark Red",
            hi: "गहरा लाल",
            pa: "ਗੂੜ੍ਹਾ ਲਾਲ",
        },
        swatch: "#8B0000",
        imageId: "45",
        position: 2,
    },

    paginatedGroupsResponse: {
        items: [
            {
                id: "12",
                code: "COLOR",
                name: {
                    en: "Color",
                    hi: "रंग",
                    pa: "ਰੰਗ",
                },
                valueType: OptionValueType.TEXT,
                isFilterable: true,
                values: [
                    {
                        id: "101",
                        code: "RED",
                        label: {
                            en: "Red",
                            hi: "लाल",
                            pa: "ਲਾਲ",
                        },
                        swatch: "#FF0000",
                        imageId: "45",
                        imageUrl:
                            "http://localhost:3000/media-public/options/images/red-thumb.webp",
                        position: 1,
                    },
                ],
            },
        ],
        total: 2,
        page: 1,
        limit: 20,
    },

    groupListResponse: {
        items: [
            {
                id: "12",
                code: "COLOR",
                name: { en: "Color", hi: "रंग", pa: "ਰੰਗ" },
                valueType: OptionValueType.TEXT,
                isFilterable: true,
                values: [],
            },
        ],
        total: 1,
        page: 1,
        limit: 20,
    },

    groupResponse: {
        id: "12",
        code: "COLOR",
        name: { en: "Color", hi: "रंग", pa: "ਰੰਗ" },
        valueType: OptionValueType.TEXT,
        isFilterable: true,
        values: [],
    },

    value: {
        id: "101",
        optionGroupId: "12",
        code: "RED",
        label: { en: "Red", hi: "लाल", pa: "ਲਾਲ" },
        swatch: "#FF0000",
        imageId: "45",
        position: 1,
    },

    valuesResponse: [
        {
            id: "101",
            optionGroupId: "12",
            code: "RED",
            label: { en: "Red", hi: "लाल", pa: "ਲਾਲ" },
            swatch: "#FF0000",
            imageId: "45",
            position: 1,
        },
        {
            id: "102",
            optionGroupId: "12",
            code: "BLUE",
            label: { en: "Blue", hi: "नीला", pa: "ਨੀਲਾ" },
            swatch: "#0000FF",
            imageId: null,
            position: 2,
        },
    ],

    deleteResponse: {
        success: true,
        id: "101",
    },

    error: {
        statusCode: 404,
        message: "Option group not found",
        error: "Not Found",
    },

    conflict: {
        statusCode: 409,
        message: "Option group is in use",
        error: "Conflict",
    },

    badRequest: {
        statusCode: 400,
        message: ["code must be a string"],
        error: "Bad Request",
    },
} as const;

/**
 * Shared Swagger schema fragments.
 */
export const OPTION_SWAGGER_SCHEMAS = {
    id: {
        type: "string",
        example: "12",
        description: "BigInt database ID serialized as a string",
    },

    localeMap: {
        type: "object",
        additionalProperties: { type: "string" },
        example: { en: "Color", hi: "रंग", pa: "ਰੰਗ" },
        description: "Localized text keyed by supported locale",
    },

    deleteResponse: {
        type: "object",
        properties: {
            success: { type: "boolean", example: true },
            id: { type: "string", example: "12" },
        },
        example: OPTION_SWAGGER_EXAMPLES.deleteResponse,
    },
};

/**
 * Shared error responses.
 */
export const OPTION_SWAGGER_ERRORS = {
    badRequest: {
        description: "Invalid query parameters, path parameters, or body",
        schema: {
            example: OPTION_SWAGGER_EXAMPLES.badRequest,
        },
    },

    notFound: {
        description: "Option group or option value was not found",
        schema: {
            example: OPTION_SWAGGER_EXAMPLES.error,
        },
    },

    conflict: {
        description:
            "The option group or value is currently used by a product or variant",
        schema: {
            example: OPTION_SWAGGER_EXAMPLES.conflict,
        },
    },

    unauthorized: {
        description: "Authentication is required",
        schema: {
            example: {
                statusCode: 401,
                message: "Unauthorized",
            },
        },
    },

    forbidden: {
        description: "The authenticated user lacks the required permission",
        schema: {
            example: {
                statusCode: 403,
                message: "Forbidden",
            },
        },
    },
};
