/**
 * Paths (relative to the API prefix, e.g. /api/v1) that responses hand to the client apps for
 * reading and uploading media. Served by src/api/account/media; keep in sync with that controller.
 */
export const MEDIA_ROUTES = {
    /** Signed-in file access (private files are checked per caller). */
    file: (id: bigint | string) => `/account/media/${id}/file`,
    /** Direct upload of the bytes of an upload session. */
    uploadContent: (id: bigint | string) =>
        `/account/media/uploads/${id}/content`,
    /** Finish an upload session. */
    uploadComplete: (id: bigint | string) =>
        `/account/media/uploads/${id}/complete`,
    /** Processing status of an upload. */
    status: (id: bigint | string) => `/account/media/${id}/status`,
} as const;
