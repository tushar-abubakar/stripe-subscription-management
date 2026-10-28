/** Swagger docs for KYC (members, store managers, admins). */
import { causes, errorSchema, IdParam } from "@common/swagger/swagger.util";
import { applyDecorators } from "@nestjs/common";
import {
    ApiBadRequestResponse,
    ApiBody,
    ApiConflictResponse,
    ApiForbiddenResponse,
    ApiNotFoundResponse,
    ApiOkResponse,
    ApiOperation,
} from "@nestjs/swagger";
import {
    KycDocDto,
    KycForwardDto,
    KycRemovalDto,
    KycReviewDto,
    KycSubmitDto,
} from "./kyc.dto";

const DOC_ID = IdParam("id", "KYC document ID", "55");
const NOT_FOUND = ApiNotFoundResponse({ description: "Document not found / not yours / not your store", schema: errorSchema(404, "Not Found", "KYC document not found") });

const DOC = (o: Record<string, unknown>) => ({
    title: null, documentNumber: null, rejectionReason: null, expiresAt: null, reviewedAt: null,
    createdAt: "2026-10-22T04:00:00.000Z", submittedAt: null, backFile: null, ...o,
});
const MY_KYC = {
    kycStatus: "PENDING",
    required: { all: ["SELFIE", "DRIVING_LICENSE", "VEHICLE_RC"], oneOf: ["NID", "PASSPORT", "DRIVING_LICENSE"] },
    missing: ["VEHICLE_RC"],
    drafts: 2,
    canSubmit: false,
    documents: [
        DOC({ id: "55", type: "NID", state: "VERIFIED", status: "VERIFIED", documentNumber: "XXXXXXXXX6789", submittedAt: "2026-10-20T04:00:00.000Z", reviewedAt: "2026-10-21T09:00:00.000Z", frontFile: "/account/media/9101/file", backFile: "/account/media/9102/file", canDelete: false, replaceable: false, removalNeedsAdmin: true }),
        DOC({ id: "56", type: "SELFIE", state: "DRAFT", status: "PENDING", frontFile: "/account/media/9103/file", canDelete: true, replaceable: true, removalNeedsAdmin: false }),
        DOC({ id: "57", type: "OTHER", title: "Police clearance certificate", state: "DRAFT", status: "PENDING", frontFile: "/account/media/9104/file", canDelete: true, replaceable: false, removalNeedsAdmin: false }),
    ],
    removalRequests: [{ id: "301", targetId: "41", status: "PENDING", note: "Old photo is blurred", reviewNote: null, createdAt: "2026-10-22T05:00:00.000Z" }],
};

const FLOW =
    "**Draft → submit.** Every upload is saved as a `DRAFT` (`state: DRAFT`): preview it (`frontFile` / `backFile`, GET with your token), " +
    "replace it (upload the same type again) or delete it. `POST …/submit` locks all drafts for review — needs the full set " +
    "(`SELFIE` + one of `NID` / `PASSPORT` / `DRIVING_LICENSE`, riders on a motor vehicle also `DRIVING_LICENSE` + `VEHICLE_RC`).\n\n" +
    "**Replacing.** One live document per type: a new upload of a type replaces the old one while it isn't approved (draft, pending or rejected). " +
    "An **approved** document is never removed by an upload — the new one waits next to it, and only an admin removes the old one (removal request).\n\n" +
    "**OTHER** = any extra document (several allowed, up to 10, `title` required). It never counts toward the required set.";

export const ApiMyKyc = () =>
    applyDecorators(
        ApiOperation({ summary: "My KYC documents and status", description: "Store staff / delivery partner. " + FLOW }),
        ApiOkResponse({ description: "KYC", schema: { example: MY_KYC } }),
    );

const ADD_EXAMPLES = {
    nid: { summary: "NID both sides", value: { type: "NID", documentNumber: "1990123456789", frontMediaId: 9101, backMediaId: 9102 } },
    selfie: { summary: "Selfie", value: { type: "SELFIE", frontMediaId: 9103 } },
    other: { summary: "OTHER document", value: { type: "OTHER", title: "Police clearance certificate", frontMediaId: 9104 } },
};
const ADD_ERRORS = ApiBadRequestResponse({
    description: causes("Invalid document", [
        "Media not KYC / not uploaded by you (KYC_MEDIA_INVALID)",
        "Media already used by another document (KYC_MEDIA_IN_USE)",
        "OTHER without a title (KYC_TITLE_REQUIRED)",
        "More than 10 OTHER documents (KYC_TOO_MANY_OTHER)",
        "`type` not uploadable (legacy AADHAAR / PAN / VOTER_ID)",
    ]),
    schema: errorSchema(400, "Bad Request", "Upload the files with purpose KYC first", "KYC_MEDIA_INVALID"),
});

export const ApiAddMyKyc = () =>
    applyDecorators(
        ApiOperation({
            summary: "Add / replace a KYC document (saved as draft)",
            description:
                "Upload the file(s) first with `POST /account/media` (purpose `KYC`), then send their ids. Response = the full KYC view plus `added` and `replaced` ids. " +
                "Blocked while a hold restricts `KYC_UPDATE`.\n\n" + FLOW,
        }),
        ApiBody({ type: KycDocDto, examples: ADD_EXAMPLES }),
        ApiOkResponse({ description: "Updated KYC view", schema: { example: { ...MY_KYC, added: "58", replaced: ["54"] } } }),
        ADD_ERRORS,
    );

export const ApiDeleteMyKyc = () =>
    applyDecorators(
        ApiOperation({ summary: "Delete a draft document", description: "Only drafts (not yet submitted); the file is deleted too. Submitted documents: replace them, or ask an admin to remove an approved one." }),
        DOC_ID,
        ApiOkResponse({ description: "Updated KYC view", schema: { example: MY_KYC } }),
        ApiBadRequestResponse({ description: "Already submitted (KYC_NOT_DRAFT)", schema: errorSchema(400, "Bad Request", "Submitted documents can't be deleted", "KYC_NOT_DRAFT") }),
        NOT_FOUND,
    );

export const ApiSubmitMyKyc = () =>
    applyDecorators(
        ApiOperation({ summary: "Submit my draft documents for review", description: "Locks every draft (`submittedAt`) and notifies the store's managers, who review and forward to the admin." }),
        ApiOkResponse({ description: "Updated KYC view", schema: { example: { ...MY_KYC, drafts: 0, canSubmit: false, submitted: 2 } } }),
        ApiBadRequestResponse({
            description: "No drafts (KYC_NOTHING_TO_SUBMIT) / required documents missing (KYC_DOCS_MISSING, with `missing`)",
            schema: errorSchema(400, "Bad Request", "KYC documents missing: VEHICLE_RC", "KYC_DOCS_MISSING"),
        }),
    );

export const ApiKycRemoval = () =>
    applyDecorators(
        ApiOperation({ summary: "Ask an admin to remove a submitted document", description: "Creates a KYC_DOC_REMOVAL approval request with your note. Approved documents are only ever removed this way. (Drafts: just delete them.)" }),
        DOC_ID,
        ApiBody({ type: KycRemovalDto }),
        ApiOkResponse({ description: "Request created", schema: { example: { success: true, approvalId: "301", status: "PENDING" } } }),
        ApiBadRequestResponse({ description: "Still a draft (KYC_IS_DRAFT)", schema: errorSchema(400, "Bad Request", "This document is still a draft: delete it directly", "KYC_IS_DRAFT") }),
        ApiConflictResponse({ description: "Already requested (code APPROVAL_ALREADY_PENDING)", schema: errorSchema(409, "Conflict", "A request for this item is already waiting for a decision", "APPROVAL_ALREADY_PENDING") }),
        NOT_FOUND,
    );

// ─── Store manager: KYC of a member being onboarded ─────────────────────────

const MEMBER_ID = IdParam("userId", "Team member (user) ID", "120");
const LOCKED = ApiForbiddenResponse({
    description: "Sign-up already sent to the admin, or member not pending (KYC_ONBOARDING_LOCKED)",
    schema: errorSchema(403, "Forbidden", "KYC can only be edited by the store before the sign-up is sent to the admin", "KYC_ONBOARDING_LOCKED"),
});
const ONBOARDING =
    "Store manager (`user.create`), for a PENDING staff member / rider of your store whose sign-up hasn't been sent yet " +
    "(created with `POST /store/team` and `submit: false`). Same draft rules as the member's own KYC; once submitted, the store can't open the files any more.";

export const ApiMemberKyc = () =>
    applyDecorators(
        ApiOperation({ summary: "KYC of a member being onboarded", description: ONBOARDING }),
        MEMBER_ID,
        ApiOkResponse({ description: "KYC", schema: { example: MY_KYC } }),
        LOCKED,
    );

export const ApiAddMemberKyc = () =>
    applyDecorators(
        ApiOperation({ summary: "Add / replace a member's KYC document (draft)", description: ONBOARDING + "\n\n" + FLOW }),
        MEMBER_ID,
        ApiBody({ type: KycDocDto, examples: ADD_EXAMPLES }),
        ApiOkResponse({ description: "Updated KYC view", schema: { example: { ...MY_KYC, added: "58", replaced: [] } } }),
        ADD_ERRORS,
        LOCKED,
    );

export const ApiDeleteMemberKyc = () =>
    applyDecorators(
        ApiOperation({ summary: "Delete a member's draft document", description: ONBOARDING }),
        MEMBER_ID,
        IdParam("docId", "KYC document ID", "56"),
        ApiOkResponse({ description: "Updated KYC view", schema: { example: MY_KYC } }),
        LOCKED,
        NOT_FOUND,
    );

export const ApiSubmitMemberKyc = () =>
    applyDecorators(
        ApiOperation({
            summary: "Submit the member's KYC and send the sign-up to the admin",
            description: ONBOARDING + " Locks the drafts and opens the MEMBER_ONBOARDING approval request (the admin activates the account and verifies the documents).",
        }),
        MEMBER_ID,
        ApiBody({ type: KycSubmitDto, required: false, examples: { note: { value: { note: "Evening shift rider" } } } }),
        ApiOkResponse({ description: "Sent", schema: { example: { success: true, approvalId: "512", status: "PENDING" } } }),
        ApiBadRequestResponse({ description: "No drafts / documents missing (KYC_DOCS_MISSING)", schema: errorSchema(400, "Bad Request", "KYC documents missing: SELFIE", "KYC_DOCS_MISSING") }),
        LOCKED,
    );

export const ApiStoreKycList = () =>
    applyDecorators(
        ApiOperation({
            summary: "KYC documents of my store's staff and delivery partners",
            description:
                "Requires `kyc.review`. Submitted documents only (drafts are still being prepared). Metadata only — the files are never visible to the store. `forensics` shows the automatic checks on the " +
                "original upload (edited / AI-suspected / no camera data / reused file) and `forwarded` the request already sent to the admin.",
        }),
        ApiOkResponse({
            description: "Documents",
            schema: {
                example: {
                    items: [
                        {
                            id: "56", type: "SELFIE", title: null, status: "PENDING", documentNumber: null, expiresAt: null, rejectionReason: null, createdAt: "2026-10-22T04:00:00.000Z",
                            uploadedBy: "SELF", user: { id: "120", name: "Rafiq", phone: "+8801812345678", role: "DELIVERY_PARTNER", approvalStatus: "APPROVED" },
                            forensics: { front: { flags: { edited: false, aiSuspected: false, noCameraData: false, reused: false }, riskScore: 0 }, back: null },
                            forwarded: null,
                        },
                    ],
                    total: 1, page: 1, limit: 20,
                },
            },
        }),
    );

export const ApiStoreKycForward = () =>
    applyDecorators(
        ApiOperation({ summary: "Forward a document to the admin", description: "Requires `kyc.review`. Store managers recommend; only an admin decides (KYC_VERIFICATION request)." }),
        DOC_ID,
        ApiBody({ type: KycForwardDto, examples: { ok: { summary: "Recommend approval", value: { recommendation: "APPROVE", note: "Checked the original at the store" } } } }),
        ApiOkResponse({ description: "Forwarded", schema: { example: { success: true, approvalId: "302" } } }),
        ApiBadRequestResponse({ description: "Document is not PENDING (code KYC_NOT_PENDING)", schema: errorSchema(400, "Bad Request", "Only pending documents can be forwarded", "KYC_NOT_PENDING") }),
        ApiConflictResponse({ description: "Already forwarded (code APPROVAL_ALREADY_PENDING)", schema: errorSchema(409, "Conflict", "A request for this item is already waiting for a decision", "APPROVAL_ALREADY_PENDING") }),
        NOT_FOUND,
    );

export const ApiAdminKycList = () =>
    applyDecorators(
        ApiOperation({ summary: "KYC documents (all stores)", description: "Requires `kyc.review`. Includes file links (`/account/media/{id}/file`, admins only) and full forensic metadata." }),
        ApiOkResponse({ description: "Documents", schema: { example: { items: [{ id: "56", userId: "120", type: "SELFIE", status: "PENDING", frontFile: "/account/media/9101/file", backFile: null, forensics: { front: { flags: { edited: true }, riskScore: 40, exif: { software: "Adobe Photoshop 25.0" } }, back: null } }], total: 1, page: 1, limit: 20 } } }),
    );

export const ApiAdminKycReview = () =>
    applyDecorators(
        ApiOperation({ summary: "Approve / reject a document", description: "Requires `kyc.review`. Also closes a pending forward request for it and notifies the member." }),
        DOC_ID,
        ApiBody({ type: KycReviewDto, examples: { approve: { value: { approve: true } }, reject: { value: { approve: false, reason: "Photo does not match selfie" } } } }),
        ApiOkResponse({ description: "Done", schema: { example: { success: true } } }),
        ApiBadRequestResponse({ description: "Reason missing when rejecting", schema: errorSchema(400, "Bad Request", "A reason is required") }),
        NOT_FOUND,
    );
