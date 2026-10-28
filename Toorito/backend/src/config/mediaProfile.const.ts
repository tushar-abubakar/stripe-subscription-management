export type ImageFit = "contain" | "cover" | "inside";

export type ImageVariantConfig = {
    width: number;
    height: number;
    fit: ImageFit;
};

export type ImageProfileConfig = {
    master: ImageVariantConfig;
    thumbnail: ImageVariantConfig;
};

export type MediaImageConfig = {
    profiles: Record<string, ImageProfileConfig>;
};

export type MediaVideoConfig = {
    maxDurationSeconds: number;
    maxBytes: number;
};

export type MediaAudioConfig = {
    maxDurationSeconds: number;
    maxBytes: number;
};

export type MediaPurposeConfig = {
    image?: MediaImageConfig;
    video?: MediaVideoConfig;
    audio?: MediaAudioConfig;
};

export type MediaConfig = {
    [purpose: string]: MediaPurposeConfig;
};

export const MEDIA_CONFIG = {
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
            maxBytes: 50 * 1024 * 1024,
        },
        audio: {
            maxDurationSeconds: 60,
            maxBytes: 10 * 1024 * 1024,
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
            maxBytes: 100 * 1024 * 1024,
        },
        audio: {
            maxDurationSeconds: 60,
            maxBytes: 10 * 1024 * 1024,
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
} as const satisfies Record<string, MediaPurposeConfig>;
