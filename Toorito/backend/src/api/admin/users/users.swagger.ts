/**
 * Swagger / OpenAPI documentation for the users module.
 *
 * Controllers in this module:
 *   - AdminUsers        /admin/users          user CRUD, status, approvals, wallet
 *   - AdminAccessRoles  /admin/access-roles   admin permission sets
 *   - StoreTeam         /store/team           store manager: own team
 *   - Me                /account, /app/wishlist  own profile, settings, avatar, phone, wallet, wishlist
 *   - CustomerAddresses /app/addresses   customer delivery addresses
 *
 * Each endpoint gets ONE composed decorator. Classes here are documentation
 * models only; validation lives in `users.dto.ts`. Bigint ids and Decimal
 * columns are documented as strings because that is how they serialize.
 */
import { CreateTeamMemberDto } from "./users.dto";
import { AddressCountryResponse } from "../stores/stores.swagger";
import { applyDecorators } from "@nestjs/common";
import {
    ApiBadRequestResponse,
    ApiBearerAuth,
    ApiBody,
    ApiConflictResponse,
    ApiConsumes,
    ApiCreatedResponse,
    ApiForbiddenResponse,
    ApiHeader,
    ApiNotFoundResponse,
    ApiOkResponse,
    ApiOperation,
    ApiParam,
    ApiProperty,
    ApiPropertyOptional,
    ApiQuery,
    ApiResponse,
    ApiTags,
    ApiUnauthorizedResponse,
} from "@nestjs/swagger";
import {
    ApprovalStatus,
    UserRole,
    UserStatus,
    WalletTxnReason,
    WalletTxnType,
} from "@prisma-client/enums";

// =====================================================================
// Shared schema fragments
// =====================================================================

const BIGINT_ID = { type: String, pattern: "^\\d+$" } as const;
const DECIMAL = { type: String, pattern: "^-?\\d+(\\.\\d+)?$" } as const;
const LOCALE_MAP = { type: "object", additionalProperties: { type: "string" } } as const;
const DATE = { type: String, format: "date-time", example: "2026-10-19T09:00:00.000Z" } as const;

function errorSchema(statusCode: number, error: string, message: string | string[]) {
    return {
        type: "object",
        required: ["statusCode", "message", "error"],
        properties: {
            statusCode: { type: "number", example: statusCode },
            message: {
                oneOf: [{ type: "string" }, { type: "array", items: { type: "string" } }],
                example: message,
            },
            error: { type: "string", example: error },
            code: { type: "string", example: "PHONE_TAKEN", description: "Machine-readable code on domain errors" },
        },
    };
}

function causes(title: string, list: string[]) {
    return `${title}\n\nPossible causes:\n${list.map((c) => `- ${c}`).join("\n")}`;
}

const ACCEPT_LANGUAGE_HEADER = ApiHeader({
    name: "Accept-Language",
    required: false,
    description: "Language for localized fields and error messages. Falls back to the default language.",
    example: "en",
});

const idParam = (what: string, example = "42") =>
    ApiParam({
        name: "id",
        description: `${what} ID (bigint, sent as a numeric string)`,
        schema: { type: "string", pattern: "^\\d+$" },
        example,
    });

const PAGE_QUERIES = [
    ApiQuery({ name: "page", required: false, type: Number, example: 1, description: "1-based page number" }),
    ApiQuery({ name: "limit", required: false, type: Number, example: 20, description: "Items per page (max 100)" }),
];

const USER_NOT_FOUND = ApiNotFoundResponse({
    description: "User not found or deleted (`users.errors.userNotFound`)",
    schema: errorSchema(404, "Not Found", "User not found"),
});

const VALIDATION_ERROR = (example: string) =>
    ApiBadRequestResponse({ description: "Body validation failed", schema: errorSchema(400, "Bad Request", [example]) });

const MANAGE_FORBIDDEN =
    "Target is a SUPER_ADMIN, an ADMIN managed by a non-SUPER_ADMIN, or yourself (`users.errors.forbidden` / `cannotManageSelf`)";

// =====================================================================
// Shared response models
// =====================================================================

export class MoneyView {
    @ApiProperty({ example: 120.5 })
    amount!: number;

    @ApiProperty({ example: "BDT" })
    currency!: string;

    @ApiProperty({ example: "৳" })
    symbol!: string;

    @ApiProperty({ example: "৳120.50" })
    formatted!: string;
}

export class CurrencyInfoView {
    @ApiProperty({ example: "BDT" })
    code!: string;

    @ApiProperty({ example: "৳" })
    symbol!: string;
}

export class AvatarView {
    @ApiProperty({ ...BIGINT_ID, example: "301" })
    id!: string;

    @ApiProperty({
        enum: ["PROCESSING", "READY", "FAILED"],
        example: "READY",
        description: "URLs are null until READY (resizing takes a second or two after upload)",
    })
    status!: string;

    @ApiProperty({ type: String, nullable: true, example: "https://cdn.example.com/avatar/2026/10/ab12-thumb.webp" })
    thumbUrl!: string | null;

    @ApiProperty({ type: String, nullable: true, example: "https://cdn.example.com/avatar/2026/10/ab12-master.webp" })
    url!: string | null;
}

export class StoreRefView {
    @ApiProperty({ ...BIGINT_ID, example: "7" })
    id!: string;

    @ApiProperty({ example: "DS-DHK-GLS01" })
    code!: string;

    @ApiProperty({ ...LOCALE_MAP, example: { en: "Gulshan Hub Dark Store" } })
    name!: Record<string, string>;
}

export class AccessRoleRefView {
    @ApiProperty({ ...BIGINT_ID, example: "2" })
    id!: string;

    @ApiProperty({ example: "CATALOG_MANAGER" })
    code!: string;

    @ApiProperty({ example: "Catalog manager" })
    name!: string;
}

export class SuccessResponse {
    @ApiProperty({ example: true })
    success!: boolean;
}

export class NotificationSettingsView {
    @ApiProperty({ example: true, description: "Order status updates" })
    orderUpdates!: boolean;

    @ApiProperty({ example: false, description: "Offers and promotions" })
    promotions!: boolean;

    @ApiProperty({ example: true })
    push!: boolean;

    @ApiProperty({ example: true })
    sms!: boolean;

    @ApiProperty({ example: false })
    email!: boolean;
}

export class UserSettingsView {
    @ApiProperty({ enum: ["LIGHT", "DARK", "SYSTEM"], example: "SYSTEM" })
    theme!: string;

    @ApiProperty({ type: () => NotificationSettingsView })
    notifications!: NotificationSettingsView;
}

// =====================================================================
// Admin users: models
// =====================================================================

export class AdminCreateUserBodyDoc {
    @ApiProperty({ enum: UserRole, example: UserRole.STORE_MANAGER, description: "ADMIN / SUPER_ADMIN only by a SUPER_ADMIN" })
    role!: UserRole;

    @ApiProperty({ example: "+8801712345678", description: "E.164 from PHONE_ALLOWED_COUNTRIES; unique per role" })
    phone!: string;

    @ApiProperty({ example: "Rahim Uddin", maxLength: 120 })
    name!: string;

    @ApiPropertyOptional({ example: "rahim@example.com" })
    email?: string;

    @ApiPropertyOptional({ example: "bn", description: "One of LANGUAGES; defaults to the default language" })
    language?: string;

    @ApiPropertyOptional({ example: "S3cure-Pass!", minLength: 8, description: "Required for ADMIN, SUPER_ADMIN, STORE_MANAGER (password login)" })
    password?: string;

    @ApiPropertyOptional({ ...BIGINT_ID, example: "7", description: "Required for STORE_MANAGER / STORE_STAFF; optional for DELIVERY_PARTNER; not allowed otherwise" })
    storeId?: string;

    @ApiPropertyOptional({ ...BIGINT_ID, example: "2", description: "Required for ADMIN (its permission set); not allowed otherwise" })
    accessRoleId?: string;
}

export class AdminUpdateUserBodyDoc {
    @ApiPropertyOptional({ example: "+8801812345678", description: "Clears `phoneVerifiedAt`" })
    phone?: string;

    @ApiPropertyOptional({ example: "Rahim Uddin" })
    name?: string;

    @ApiPropertyOptional({ type: String, nullable: true, example: null, description: "null clears it" })
    email?: string | null;

    @ApiPropertyOptional({ example: "en" })
    language?: string;

    @ApiPropertyOptional({ example: "N3w-Pass-2026", description: "Password roles only; signs the user out everywhere" })
    password?: string;

    @ApiPropertyOptional({
        ...BIGINT_ID,
        nullable: true,
        example: "9",
        description: "Store roles only. Assigns / moves to a store; null removes from the store. Signs the user out.",
    })
    storeId?: string | null;

    @ApiPropertyOptional({ ...BIGINT_ID, example: "3", description: "ADMIN only" })
    accessRoleId?: string;
}

export class SetStatusBodyDoc {
    @ApiProperty({ enum: UserStatus, example: UserStatus.SUSPENDED, description: "ACTIVE enables; SUSPENDED / BLOCKED disable and sign out" })
    status!: UserStatus;

    @ApiPropertyOptional({ example: "Repeated failed deliveries", maxLength: 255 })
    reason?: string;
}

export class RejectBodyDoc {
    @ApiProperty({ example: "Documents unreadable", maxLength: 255 })
    reason!: string;
}

export class UnblockOtpBodyDoc {
    @ApiProperty({ example: "+8801712345678" })
    phone!: string;

    @ApiProperty({ enum: UserRole, example: UserRole.CUSTOMER })
    role!: UserRole;
}

export class WalletAdjustBodyDoc {
    @ApiProperty({ enum: [WalletTxnType.CREDIT, WalletTxnType.DEBIT], example: WalletTxnType.CREDIT })
    type!: WalletTxnType;

    @ApiProperty({ example: 50, minimum: 0.01 })
    amount!: number;

    @ApiProperty({ example: "Goodwill credit for late delivery #QC-261019-A1B2C3", maxLength: 255 })
    note!: string;

    @ApiPropertyOptional({ example: "ticket-8812-credit", description: "8–48 chars [A-Za-z0-9_-]; the same key never applies twice" })
    idempotencyKey?: string;
}

export class AdminUserListItem {
    @ApiProperty({ ...BIGINT_ID, example: "42" })
    id!: string;

    @ApiProperty({ example: "+8801712345678" })
    phone!: string;

    @ApiProperty({ type: String, nullable: true, example: "Rahim Uddin" })
    name!: string | null;

    @ApiProperty({ type: String, nullable: true, example: "rahim@example.com" })
    email!: string | null;

    @ApiProperty({ enum: UserRole, example: UserRole.STORE_MANAGER })
    role!: UserRole;

    @ApiProperty({ enum: UserStatus, example: UserStatus.ACTIVE })
    status!: UserStatus;

    @ApiProperty({ enum: ApprovalStatus, example: ApprovalStatus.APPROVED })
    approvalStatus!: ApprovalStatus;

    @ApiProperty({ ...BIGINT_ID, nullable: true, example: "7" })
    storeId!: string | null;

    @ApiProperty({ type: () => StoreRefView, nullable: true })
    store!: StoreRefView | null;

    @ApiProperty({ type: () => AccessRoleRefView, nullable: true, example: null })
    accessRole!: AccessRoleRefView | null;

    @ApiProperty({ type: () => AvatarView, nullable: true })
    avatar!: AvatarView | null;

    @ApiProperty({ type: () => MoneyView })
    walletBalance!: MoneyView;

    @ApiProperty({ ...DATE, nullable: true })
    lastLoginAt!: string | null;

    @ApiProperty(DATE)
    createdAt!: string;
}

export class AdminUserListResponse {
    @ApiProperty({ type: () => [AdminUserListItem] })
    items!: AdminUserListItem[];

    @ApiProperty({ example: 57 })
    total!: number;

    @ApiProperty({ example: 1 })
    page!: number;

    @ApiProperty({ example: 20 })
    limit!: number;
}

export class PartnerSummaryView {
    @ApiProperty({ example: "VERIFIED" })
    kycStatus!: string;

    @ApiProperty({ type: String, nullable: true, example: "BIKE" })
    vehicleType!: string | null;

    @ApiProperty({ example: false })
    isOnline!: boolean;

    @ApiProperty({ example: 0 })
    activeOrderCount!: number;
}

export class AdminUserCountsView {
    @ApiProperty({ example: 14 })
    orders!: number;

    @ApiProperty({ example: 2 })
    addresses!: number;

    @ApiProperty({ example: 5 })
    wishlist!: number;

    @ApiProperty({ example: 1, description: "Active (not revoked) sessions" })
    sessions!: number;
}

export class AdminUserDetailResponse extends AdminUserListItem {
    @ApiProperty({ example: "en" })
    language!: string;

    @ApiProperty({ type: () => UserSettingsView })
    settings!: UserSettingsView;

    @ApiProperty({ type: String, nullable: true, example: null })
    statusReason!: string | null;

    @ApiProperty({ type: String, nullable: true, example: null })
    rejectionReason!: string | null;

    @ApiProperty({ ...BIGINT_ID, nullable: true, example: "1" })
    approvedById!: string | null;

    @ApiProperty({ ...DATE, nullable: true })
    approvedAt!: string | null;

    @ApiProperty({ ...DATE, nullable: true })
    phoneVerifiedAt!: string | null;

    @ApiProperty(DATE)
    updatedAt!: string;

    @ApiProperty({ type: () => PartnerSummaryView, nullable: true, example: null, description: "DELIVERY_PARTNER only" })
    partnerProfile!: PartnerSummaryView | null;

    @ApiProperty({ type: () => AdminUserCountsView })
    _count!: AdminUserCountsView;
}

export class UserDeleteResponse {
    @ApiProperty({ example: true })
    success!: boolean;

    @ApiProperty({ ...BIGINT_ID, example: "42" })
    id!: string;
}

export class StatusChangeResponse {
    @ApiProperty({ example: true })
    success!: boolean;

    @ApiProperty({ enum: UserStatus, example: UserStatus.SUSPENDED })
    status!: UserStatus;
}

export class WalletTxnView {
    @ApiProperty({ ...BIGINT_ID, example: "915" })
    id!: string;

    @ApiProperty({ enum: WalletTxnType, example: WalletTxnType.CREDIT })
    type!: WalletTxnType;

    @ApiProperty({ enum: WalletTxnReason, example: WalletTxnReason.REFUND })
    reason!: WalletTxnReason;

    @ApiProperty({ type: () => MoneyView })
    amount!: MoneyView;

    @ApiProperty({ type: () => MoneyView })
    balanceAfter!: MoneyView;

    @ApiProperty({ ...BIGINT_ID, nullable: true, example: "1203" })
    orderId!: string | null;

    @ApiProperty({ type: String, nullable: true, example: null })
    note!: string | null;

    @ApiProperty(DATE)
    createdAt!: string;
}

export class WalletResponse {
    @ApiProperty({ type: () => CurrencyInfoView })
    currency!: CurrencyInfoView;

    @ApiProperty({ type: () => MoneyView })
    balance!: MoneyView;

    @ApiProperty({ type: () => [WalletTxnView], description: "Newest first" })
    items!: WalletTxnView[];

    @ApiProperty({ example: 12 })
    total!: number;

    @ApiProperty({ example: 1 })
    page!: number;

    @ApiProperty({ example: 20 })
    limit!: number;
}

export class WalletAdjustResponse {
    @ApiProperty({ example: true })
    success!: boolean;

    @ApiProperty({ example: false, description: "true when the idempotency key was already used (nothing changed)" })
    duplicate!: boolean;

    @ApiProperty({ type: () => MoneyView })
    balance!: MoneyView;
}

// =====================================================================
// Access roles: models
// =====================================================================

export class AccessRoleBodyDoc {
    @ApiProperty({ example: "CATALOG_MANAGER", maxLength: 50 })
    code!: string;

    @ApiProperty({ example: "Catalog manager", maxLength: 100 })
    name!: string;

    @ApiProperty({ type: [String], example: ["category.read", "category.create", "product.read", "product.update"] })
    permissions!: string[];

    @ApiPropertyOptional({ example: true })
    isActive?: boolean;
}

export class AccessRoleResponse extends AccessRoleBodyDoc {
    @ApiProperty({ ...BIGINT_ID, example: "2" })
    id!: string;

    @ApiProperty(DATE)
    createdAt!: string;

    @ApiProperty(DATE)
    updatedAt!: string;
}

export class PermissionListResponse {
    @ApiProperty({ type: [String], example: ["store.create", "store.read", "user.read", "user.create", "user.delete", "wallet.adjust"] })
    items!: string[];

    @ApiProperty({ example: 62 })
    total!: number;

    @ApiProperty({ example: 1 })
    page!: number;

    @ApiProperty({ example: 62 })
    limit!: number;
}

// =====================================================================
// Store team: models
// =====================================================================

export class TeamPartnerView {
    @ApiProperty({ example: true })
    isOnline!: boolean;

    @ApiProperty({ example: true })
    isAvailable!: boolean;

    @ApiProperty({ example: 1 })
    activeOrderCount!: number;

    @ApiProperty({ example: "VERIFIED" })
    kycStatus!: string;
}

export class TeamMemberResponse {
    @ApiProperty({ ...BIGINT_ID, example: "88" })
    id!: string;

    @ApiProperty({ example: "+8801912345678" })
    phone!: string;

    @ApiProperty({ type: String, nullable: true, example: "Karim" })
    name!: string | null;

    @ApiProperty({ enum: [UserRole.STORE_STAFF, UserRole.DELIVERY_PARTNER], example: UserRole.STORE_STAFF })
    role!: UserRole;

    @ApiProperty({ enum: UserStatus, example: UserStatus.ACTIVE })
    status!: UserStatus;

    @ApiProperty({ enum: ApprovalStatus, example: ApprovalStatus.APPROVED })
    approvalStatus!: ApprovalStatus;

    @ApiProperty({ type: () => TeamPartnerView, nullable: true, example: null })
    partnerProfile!: TeamPartnerView | null;
}

export class PendingMemberResponse {
    @ApiProperty({ ...BIGINT_ID, example: "91" })
    id!: string;

    @ApiProperty({ example: "+8801612345678" })
    phone!: string;

    @ApiProperty({ type: String, nullable: true, example: "Sabbir" })
    name!: string | null;

    @ApiProperty({ enum: [UserRole.STORE_STAFF, UserRole.DELIVERY_PARTNER], example: UserRole.DELIVERY_PARTNER })
    role!: UserRole;

    @ApiProperty({ ...BIGINT_ID, nullable: true, example: "7" })
    storeId!: string | null;

    @ApiProperty(DATE)
    createdAt!: string;

    @ApiProperty({
        nullable: true,
        example: { kycStatus: "SUBMITTED", vehicleType: "BIKE" },
        type: "object",
        properties: { kycStatus: { type: "string" }, vehicleType: { type: "string", nullable: true } },
    })
    partnerProfile!: { kycStatus: string; vehicleType: string | null } | null;
}

// =====================================================================
// Me: models
// =====================================================================

export class NotificationSettingsBodyDoc {
    @ApiPropertyOptional({ example: true })
    orderUpdates?: boolean;

    @ApiPropertyOptional({ example: false })
    promotions?: boolean;

    @ApiPropertyOptional({ example: true })
    push?: boolean;

    @ApiPropertyOptional({ example: true })
    sms?: boolean;

    @ApiPropertyOptional({ example: false })
    email?: boolean;
}

export class SettingsBodyDoc {
    @ApiPropertyOptional({ enum: ["LIGHT", "DARK", "SYSTEM"], example: "DARK" })
    theme?: string;

    @ApiPropertyOptional({ type: () => NotificationSettingsBodyDoc })
    notifications?: NotificationSettingsBodyDoc;
}

export class ProfileBodyDoc {
    @ApiPropertyOptional({ example: "Nusrat Jahan", maxLength: 120 })
    name?: string;

    @ApiPropertyOptional({ type: String, nullable: true, example: "nusrat@example.com", description: "null clears it" })
    email?: string | null;

    @ApiPropertyOptional({ example: "bn", description: "Default app / notification language (one of LANGUAGES)" })
    language?: string;

    @ApiPropertyOptional({ type: () => SettingsBodyDoc, description: "Merged into saved settings; send only what changes" })
    settings?: SettingsBodyDoc;
}

export class AvatarBodyDoc {
    @ApiProperty({
        type: "string",
        format: "binary",
        description: "JPEG / PNG / WebP. Cropped to a 512×512 square (200×200 thumbnail); must be at least that size.",
    })
    file!: unknown;
}

export class PhoneChangeRequestBodyDoc {
    @ApiProperty({ example: "+8801812345678", description: "E.164 from PHONE_ALLOWED_COUNTRIES" })
    newPhone!: string;
}

export class PhoneChangeVerifyBodyDoc {
    @ApiProperty({ example: "482913", description: "Code sent to your current phone" })
    currentPhoneCode!: string;

    @ApiProperty({ example: "105377", description: "Code sent to the new phone" })
    newPhoneCode!: string;

    @ApiPropertyOptional({ example: "ios-7F3A" })
    deviceId?: string;
}

export class ProfileWalletView {
    @ApiProperty({ type: () => CurrencyInfoView })
    currency!: CurrencyInfoView;

    @ApiProperty({ type: () => MoneyView })
    balance!: MoneyView;
}

export class ProfileCountsView {
    @ApiProperty({ example: 2 })
    addresses!: number;

    @ApiProperty({ example: 5 })
    wishlist!: number;
}

export class ProfileResponse {
    @ApiProperty({ ...BIGINT_ID, example: "42" })
    id!: string;

    @ApiProperty({ example: "+8801712345678" })
    phone!: string;

    @ApiProperty({ type: String, nullable: true, example: "Nusrat Jahan" })
    name!: string | null;

    @ApiProperty({ type: String, nullable: true, example: "nusrat@example.com" })
    email!: string | null;

    @ApiProperty({ enum: UserRole, example: UserRole.CUSTOMER })
    role!: UserRole;

    @ApiProperty({ example: "bn" })
    language!: string;

    @ApiProperty({ ...DATE, nullable: true })
    phoneVerifiedAt!: string | null;

    @ApiProperty(DATE)
    createdAt!: string;

    @ApiProperty({ type: () => AvatarView, nullable: true })
    avatar!: AvatarView | null;

    @ApiProperty({ type: () => StoreRefView, nullable: true, example: null, description: "Store roles only" })
    store!: StoreRefView | null;

    @ApiProperty({ type: () => UserSettingsView })
    settings!: UserSettingsView;

    @ApiProperty({ type: () => ProfileWalletView })
    wallet!: ProfileWalletView;

    @ApiProperty({ type: () => ProfileCountsView })
    counts!: ProfileCountsView;
}

export class PhoneChangeRequestResponse {
    @ApiProperty({ example: "+880*******678", description: "Masked current phone" })
    currentPhone!: string;

    @ApiProperty({ example: "+8801812345678" })
    newPhone!: string;

    @ApiProperty({ example: 300 })
    expiresInSec!: number;

    @ApiProperty({ example: 30, description: "Seconds until a resend is allowed" })
    nextSendInSec!: number;

    @ApiPropertyOptional({
        description: "Development only (OTP_DEV_ECHO)",
        example: { currentPhone: "482913", newPhone: "105377" },
        type: "object",
        properties: { currentPhone: { type: "string" }, newPhone: { type: "string" } },
    })
    devCodes?: { currentPhone?: string; newPhone?: string };
}

export class WishlistItemView {
    @ApiProperty({ ...BIGINT_ID, example: "512" })
    productId!: string;

    @ApiProperty({ example: "fresh-milk-1l" })
    slug!: string;

    @ApiProperty({ example: "Fresh Milk 1 L", description: "Localized; falls back to the default language" })
    title!: string;

    @ApiProperty({ type: String, nullable: true, example: "https://cdn.example.com/product/2026/10/9f-thumb.webp" })
    thumbnailUrl!: string | null;

    @ApiProperty({ example: true, description: "false when the product was unpublished or deleted" })
    available!: boolean;

    @ApiPropertyOptional({ type: () => MoneyView, nullable: true, description: "With `storeId` only: lowest variant price there" })
    price?: MoneyView | null;

    @ApiPropertyOptional({ type: () => MoneyView, nullable: true, description: "With `storeId` only" })
    mrp?: MoneyView | null;

    @ApiPropertyOptional({ example: true, description: "With `storeId` only" })
    inStock?: boolean;

    @ApiProperty(DATE)
    addedAt!: string;
}

export class WishlistResponse {
    @ApiProperty({ type: () => [WishlistItemView] })
    items!: WishlistItemView[];

    @ApiProperty({ example: 5 })
    total!: number;

    @ApiProperty({ example: 1 })
    page!: number;

    @ApiProperty({ example: 20 })
    limit!: number;
}

export class WishlistCheckResponse {
    @ApiProperty({ type: [String], example: ["512", "530"], description: "The requested ids that are in your wishlist" })
    wishlisted!: string[];
}

export class WishlistToggleResponse {
    @ApiProperty({ ...BIGINT_ID, example: "512" })
    productId!: string;

    @ApiProperty({ example: true })
    wishlisted!: boolean;

    @ApiProperty({ example: 6, description: "Items now in the wishlist" })
    count!: number;
}

// =====================================================================
// Customer addresses: models
// =====================================================================

export class AddressBodyDoc {
    @ApiPropertyOptional({ example: "Home", maxLength: 40 })
    label?: string;

    @ApiProperty({ example: "Nusrat Jahan" })
    receiverName!: string;

    @ApiProperty({ example: "+8801712345678", description: "E.164 from PHONE_ALLOWED_COUNTRIES" })
    receiverPhone!: string;

    @ApiProperty({ example: "BD", description: "One of the countries from GET /app/addresses/format" })
    countryCode!: string;

    @ApiProperty({ example: "C", description: "Level-1 region code (state / division)" })
    stateCode!: string;

    @ApiPropertyOptional({ example: "13", nullable: true, description: "Level-2 region code; required when the level-1 region has children" })
    districtCode?: string | null;

    @ApiProperty({ example: "Dhaka" })
    city!: string;

    @ApiProperty({ example: "House 12, Road 90, Gulshan 2" })
    line1!: string;

    @ApiPropertyOptional({ example: "Flat 4B" })
    line2?: string;

    @ApiPropertyOptional({ example: "Opposite Gulshan Lake Park" })
    landmark?: string;

    @ApiPropertyOptional({ example: "1212", description: "Validated with the country's postcode rule" })
    pincode?: string;

    @ApiProperty({ example: 23.7925 })
    latitude!: number;

    @ApiProperty({ example: 90.4078 })
    longitude!: number;

    @ApiPropertyOptional({ example: "ChIJ0wJ3x5bHVTcRQmA2zJr7r3U" })
    placeId?: string;

    @ApiPropertyOptional({ example: true, description: "The first address is always the default" })
    isDefault?: boolean;
}

export class AddressResponse {
    @ApiProperty({ ...BIGINT_ID, example: "77" })
    id!: string;

    @ApiProperty({ ...BIGINT_ID, example: "42" })
    userId!: string;

    @ApiProperty({ type: String, nullable: true, example: "Home" })
    label!: string | null;

    @ApiProperty({ example: "Nusrat Jahan" })
    receiverName!: string;

    @ApiProperty({ example: "+8801712345678" })
    receiverPhone!: string;

    @ApiProperty({ example: "House 12, Road 90, Gulshan 2" })
    line1!: string;

    @ApiProperty({ type: String, nullable: true, example: "Flat 4B" })
    line2!: string | null;

    @ApiProperty({ type: String, nullable: true, example: null })
    landmark!: string | null;

    @ApiProperty({ type: String, nullable: true, example: "BD", description: "null only on addresses saved before validation existed" })
    countryCode!: string | null;

    @ApiProperty({ type: String, nullable: true, example: "C" })
    stateCode!: string | null;

    @ApiProperty({ example: "Dhaka" })
    state!: string;

    @ApiProperty({ type: String, nullable: true, example: "13" })
    districtCode!: string | null;

    @ApiProperty({ type: String, nullable: true, example: "Dhaka" })
    district!: string | null;

    @ApiProperty({ example: "Dhaka" })
    city!: string;

    @ApiProperty({ example: "1212" })
    pincode!: string;

    @ApiProperty({ ...DECIMAL, example: "23.7925" })
    latitude!: string;

    @ApiProperty({ ...DECIMAL, example: "90.4078" })
    longitude!: string;

    @ApiProperty({ type: String, nullable: true, example: null })
    placeId!: string | null;

    @ApiProperty({ example: true })
    isDefault!: boolean;

    @ApiProperty(DATE)
    createdAt!: string;

    @ApiProperty(DATE)
    updatedAt!: string;
}

export class AddressFormatResponse {
    @ApiProperty({ type: () => [AddressCountryResponse], description: "Countries → cascading regions, postcode rule" })
    countries!: AddressCountryResponse[];
}

// =====================================================================
// Controller-level decorators
// =====================================================================

const authErrors = (forbidden: string) =>
    applyDecorators(
        ApiBearerAuth(),
        ACCEPT_LANGUAGE_HEADER,
        ApiUnauthorizedResponse({
            description: "Missing, invalid or expired bearer token, or the account is no longer active",
            schema: errorSchema(401, "Unauthorized", "Unauthorized"),
        }),
        ApiForbiddenResponse({ description: forbidden, schema: errorSchema(403, "Forbidden", "Forbidden resource") }),
    );

export const ApiAdminUsersController = () =>
    applyDecorators(ApiTags("AdminUsers"), authErrors("Not ADMIN / SUPER_ADMIN, or the required permission is missing"));

export const ApiAdminAccessRolesController = () =>
    applyDecorators(ApiTags("AdminAccessRoles"), authErrors("Not SUPER_ADMIN (or missing `accessrole.manage` for the permission list)"));

export const ApiStoreTeamController = () =>
    applyDecorators(ApiTags("StoreTeam"), authErrors("Not STORE_MANAGER, missing permission, or the member is not in your store"));

export const ApiMeController = () => applyDecorators(ApiTags("Me"), authErrors("Endpoint not available for your role"));

export const ApiCustomerAddressesController = () =>
    applyDecorators(ApiTags("CustomerAddresses"), authErrors("Only customers have delivery addresses"));

// =====================================================================
// Admin users: endpoints
// =====================================================================

/** GET /admin/users */
export const ApiAdminUserList = () =>
    applyDecorators(
        ApiOperation({
            summary: "List users (paginated)",
            description:
                "Requires `user.read`. Every role in one list; filter by role, status, approval, store. " +
                "`approvalStatus=PENDING` is the approval queue. Search matches name, email and phone.",
        }),
        ...PAGE_QUERIES,
        ApiQuery({ name: "role", required: false, enum: UserRole }),
        ApiQuery({ name: "status", required: false, enum: UserStatus }),
        ApiQuery({ name: "approvalStatus", required: false, enum: ApprovalStatus }),
        ApiQuery({ name: "storeId", required: false, type: String, example: "7" }),
        ApiQuery({ name: "q", required: false, type: String, example: "rahim" }),
        ApiQuery({ name: "sort", required: false, enum: ["newest", "oldest", "name_asc", "name_desc", "last_login"], description: "Default: newest" }),
        ApiOkResponse({ description: "One page of users", type: AdminUserListResponse }),
        VALIDATION_ERROR("role has an invalid value"),
    );

/** POST /admin/users */
export const ApiAdminCreateUser = () =>
    applyDecorators(
        ApiOperation({
            summary: "Create a user with a role",
            description:
                "Requires `user.create`. ADMIN / SUPER_ADMIN can only be created by a SUPER_ADMIN. " +
                "Store managers and staff are assigned to a store here. Users are created APPROVED, except " +
                "DELIVERY_PARTNER (PENDING until KYC is verified and approved). Staff, partners and customers " +
                "sign in with OTP; admins and managers with password + OTP.",
        }),
        ApiBody({
            type: AdminCreateUserBodyDoc,
            examples: {
                manager: {
                    summary: "Store manager assigned to a store",
                    value: { role: "STORE_MANAGER", phone: "+8801712345678", name: "Rahim Uddin", password: "S3cure-Pass!", storeId: "7" },
                },
                staff: {
                    summary: "Store staff assigned to a store",
                    value: { role: "STORE_STAFF", phone: "+8801912345678", name: "Karim", storeId: "7" },
                },
                admin: {
                    summary: "Admin with an access role (SUPER_ADMIN only)",
                    value: { role: "ADMIN", phone: "+8801512345678", name: "Ops Admin", email: "ops@example.com", password: "S3cure-Pass!", accessRoleId: "2" },
                },
                customer: { summary: "Customer", value: { role: "CUSTOMER", phone: "+8801612345678", name: "Nusrat Jahan", language: "bn" } },
            },
        }),
        ApiCreatedResponse({ description: "Created user", type: AdminUserDetailResponse }),
        ApiBadRequestResponse({
            description: causes("Invalid payload", [
                "Body validation failed (bad phone, short password, missing storeId / accessRoleId for the role …)",
                "`storeId` sent for a role without a store (`users.errors.storeNotAllowed`)",
                "`accessRoleId` sent for a non-ADMIN (`users.errors.accessRoleNotAllowed`) or role inactive (`accessRoleInactive`)",
            ]),
            schema: errorSchema(400, "Bad Request", ["storeId must be an integer number"]),
        }),
        ApiResponse({ status: 403, description: "Creating ADMIN / SUPER_ADMIN without being SUPER_ADMIN", schema: errorSchema(403, "Forbidden", "You are not allowed to perform this action") }),
        ApiNotFoundResponse({ description: "Store or access role not found (`users.errors.storeNotFound` / `accessRoleNotFound`)", schema: errorSchema(404, "Not Found", "Store not found") }),
        ApiConflictResponse({ description: "Phone already used by an account with this role (`users.errors.phoneTaken`)", schema: errorSchema(409, "Conflict", "+8801712345678 is already registered as STORE_MANAGER.") }),
    );

/** POST /admin/users/unblock-otp */
export const ApiAdminUnblockOtp = () =>
    applyDecorators(
        ApiOperation({ summary: "Unblock OTP for a phone + role", description: "Requires `otp.unblock`. Clears OTP rate-limit / abuse blocks." }),
        ApiBody({ type: UnblockOtpBodyDoc }),
        ApiOkResponse({ description: "Unblocked", type: SuccessResponse }),
        VALIDATION_ERROR("phone must be a valid international number"),
    );

/** GET /admin/users/:id */
export const ApiAdminUserGet = () =>
    applyDecorators(
        ApiOperation({ summary: "Get a user", description: "Requires `user.read`. Full detail for the edit / review screen." }),
        idParam("User"),
        ApiOkResponse({ description: "User detail", type: AdminUserDetailResponse }),
        USER_NOT_FOUND,
    );

/** PATCH /admin/users/:id */
export const ApiAdminUpdateUser = () =>
    applyDecorators(
        ApiOperation({
            summary: "Update a user (partial)",
            description:
                "Requires `user.update`. Edit identity, reset a password, assign / move / remove a store, or change an " +
                "admin's access role. The role itself cannot change. Password and store changes sign the user out.",
        }),
        idParam("User"),
        ApiBody({
            type: AdminUpdateUserBodyDoc,
            examples: {
                moveStore: { summary: "Move staff to another store", value: { storeId: "9" } },
                removeStore: { summary: "Remove from store", value: { storeId: null } },
                resetPassword: { summary: "Reset a manager's password", value: { password: "N3w-Pass-2026" } },
                rename: { summary: "Rename / clear email", value: { name: "Rahim U.", email: null } },
            },
        }),
        ApiOkResponse({ description: "Updated user", type: AdminUserDetailResponse }),
        ApiBadRequestResponse({
            description: causes("Invalid change", [
                "Password for a non-password role (`users.errors.passwordNotAllowed`)",
                "Store for a role without a store (`storeNotAllowed`)",
                "Access role for a non-ADMIN (`accessRoleNotAllowed`) or inactive role (`accessRoleInactive`)",
            ]),
            schema: errorSchema(400, "Bad Request", "STORE_STAFF users sign in with OTP and have no password."),
        }),
        ApiResponse({ status: 403, description: MANAGE_FORBIDDEN, schema: errorSchema(403, "Forbidden", "You can't change your own account here.") }),
        USER_NOT_FOUND,
        ApiConflictResponse({ description: "New phone already used for this role (`users.errors.phoneTaken`)", schema: errorSchema(409, "Conflict", "+8801812345678 is already registered as CUSTOMER.") }),
    );

/** DELETE /admin/users/:id */
export const ApiAdminDeleteUser = () =>
    applyDecorators(
        ApiOperation({
            summary: "Delete a user",
            description:
                "Requires `user.delete`. Soft delete: the account is signed out and can no longer log in, its phone is " +
                "released (so it can register again) and the wishlist is cleared. Orders and wallet history stay. " +
                "A user with a positive wallet balance must be debited to zero first.",
        }),
        idParam("User"),
        ApiOkResponse({ description: "Deleted", type: UserDeleteResponse }),
        ApiResponse({ status: 403, description: MANAGE_FORBIDDEN, schema: errorSchema(403, "Forbidden", "You are not allowed to perform this action") }),
        USER_NOT_FOUND,
        ApiConflictResponse({ description: "Wallet balance is not zero (`users.errors.walletNotEmpty`)", schema: errorSchema(409, "Conflict", "Wallet still holds ৳120.00. Debit it before deleting the user.") }),
    );

/** PATCH /admin/users/:id/status */
export const ApiAdminSetUserStatus = () =>
    applyDecorators(
        ApiOperation({ summary: "Enable or disable a user", description: "Requires `user.block`. ACTIVE enables; SUSPENDED / BLOCKED disable and sign the user out everywhere." }),
        idParam("User"),
        ApiBody({ type: SetStatusBodyDoc, examples: { disable: { value: { status: "SUSPENDED", reason: "Under review" } }, enable: { value: { status: "ACTIVE" } } } }),
        ApiOkResponse({ description: "Status changed", type: StatusChangeResponse }),
        VALIDATION_ERROR("status has an invalid value"),
        ApiResponse({ status: 403, description: MANAGE_FORBIDDEN, schema: errorSchema(403, "Forbidden", "You are not allowed to perform this action") }),
        USER_NOT_FOUND,
    );

/** POST /admin/users/:id/approve */
export const ApiAdminApproveUser = () =>
    applyDecorators(
        ApiOperation({ summary: "Approve a user", description: "Requires `user.approve`. For STORE_MANAGER, STORE_STAFF and DELIVERY_PARTNER. Delivery partners need VERIFIED KYC." }),
        idParam("User"),
        ApiOkResponse({ description: "Approved", type: SuccessResponse }),
        ApiBadRequestResponse({
            description: causes("Cannot approve", ["Role does not need approval (`users.errors.userTypeDoesNotNeedApproval`)", "Delivery partner KYC not verified (`kycRequired`)"]),
            schema: errorSchema(400, "Bad Request", "Identity verification (KYC) must be verified before approving a delivery partner"),
        }),
        USER_NOT_FOUND,
    );

/** POST /admin/users/:id/reject */
export const ApiAdminRejectUser = () =>
    applyDecorators(
        ApiOperation({ summary: "Reject a user", description: "Requires `user.approve`. Stores the reason and signs the user out." }),
        idParam("User"),
        ApiBody({ type: RejectBodyDoc }),
        ApiOkResponse({ description: "Rejected", type: SuccessResponse }),
        ApiBadRequestResponse({ description: "Missing reason, or role does not need approval", schema: errorSchema(400, "Bad Request", ["reason is required"]) }),
        USER_NOT_FOUND,
    );

/** GET /admin/users/:id/wallet */
export const ApiAdminUserWallet = () =>
    applyDecorators(
        ApiOperation({ summary: "Get a user's wallet and history", description: "Requires `user.read`. Balance plus the paginated ledger, newest first." }),
        idParam("User"),
        ...PAGE_QUERIES,
        ApiQuery({ name: "type", required: false, enum: WalletTxnType }),
        ApiQuery({ name: "reason", required: false, enum: WalletTxnReason }),
        ApiOkResponse({ description: "Wallet", type: WalletResponse }),
        USER_NOT_FOUND,
    );

/** POST /admin/users/:id/wallet */
export const ApiAdminAdjustWallet = () =>
    applyDecorators(
        ApiOperation({
            summary: "Credit or debit a user's wallet",
            description:
                "Requires `wallet.adjust`. Atomic balance change plus a ledger entry (reason ADMIN_ADJUSTMENT) with your " +
                "id and the note. Send an `idempotencyKey` to make retries safe.",
        }),
        idParam("User"),
        ApiBody({
            type: WalletAdjustBodyDoc,
            examples: {
                credit: { value: { type: "CREDIT", amount: 50, note: "Goodwill credit", idempotencyKey: "ticket-8812-credit" } },
                debit: { value: { type: "DEBIT", amount: 120, note: "Clear balance before account deletion" } },
            },
        }),
        ApiOkResponse({ description: "Adjusted", type: WalletAdjustResponse }),
        ApiBadRequestResponse({ description: "Invalid amount, or debit larger than the balance (`users.errors.insufficientBalance`)", schema: errorSchema(400, "Bad Request", "The wallet balance is too low for this debit.") }),
        ApiResponse({ status: 403, description: MANAGE_FORBIDDEN, schema: errorSchema(403, "Forbidden", "You are not allowed to perform this action") }),
        USER_NOT_FOUND,
    );

// =====================================================================
// Access roles: endpoints
// =====================================================================

/** GET /admin/access-roles */
export const ApiListAccessRoles = () =>
    applyDecorators(
        ApiOperation({ summary: "List access roles", description: "SUPER_ADMIN only." }),
        ApiOkResponse({ description: "All access roles", type: AccessRoleResponse, isArray: true }),
    );

/** GET /admin/access-roles/permissions */
export const ApiListPermissions = () =>
    applyDecorators(
        ApiOperation({ summary: "List every permission code", description: "Requires `accessrole.manage`. For building access-role forms." }),
        ApiOkResponse({ description: "Permission codes", type: PermissionListResponse }),
    );

/** POST /admin/access-roles */
export const ApiCreateAccessRole = () =>
    applyDecorators(
        ApiOperation({ summary: "Create an access role", description: "SUPER_ADMIN only." }),
        ApiBody({ type: AccessRoleBodyDoc }),
        ApiCreatedResponse({ description: "Created", type: AccessRoleResponse }),
        VALIDATION_ERROR("permissions should not be empty"),
    );

/** PUT /admin/access-roles/:id */
export const ApiUpdateAccessRole = () =>
    applyDecorators(
        ApiOperation({ summary: "Replace an access role", description: "SUPER_ADMIN only. Clears the permission cache of every admin with this role." }),
        idParam("Access role", "2"),
        ApiBody({ type: AccessRoleBodyDoc }),
        ApiOkResponse({ description: "Updated", type: AccessRoleResponse }),
        VALIDATION_ERROR("permissions should not be empty"),
    );

// =====================================================================
// Store team: endpoints
// =====================================================================

const TEAM_ROLE_QUERY = ApiQuery({ name: "role", required: false, enum: [UserRole.STORE_STAFF, UserRole.DELIVERY_PARTNER] });

/** GET /store/team */
export const ApiStoreTeamList = () =>
    applyDecorators(
        ApiOperation({ summary: "List my store's team", description: "Requires `user.read`. Staff and delivery partners of your store." }),
        ...PAGE_QUERIES,
        TEAM_ROLE_QUERY,
        ApiOkResponse({ description: "Team members", type: TeamMemberResponse, isArray: true }),
    );

/** GET /store/team/pending */
export const ApiStoreTeamPending = () =>
    applyDecorators(
        ApiOperation({ summary: "List my store's pending sign-ups", description: "Requires `user.read`. Oldest first." }),
        ...PAGE_QUERIES,
        TEAM_ROLE_QUERY,
        ApiOkResponse({ description: "Pending members", type: PendingMemberResponse, isArray: true }),
    );

/** POST /store/team/:id/approve */
export const ApiStoreTeamApprove = () =>
    applyDecorators(
        ApiOperation({ summary: "Recommend a team member to the admin", description: "Requires `user.approve`. A store manager can't activate accounts: this forwards (or reuses) the MEMBER_ONBOARDING approval request; the admin activates the account and verifies the KYC in one decision. Response: `{ success, forwarded: true, approvalId }`." }),
        idParam("User", "91"),
        ApiOkResponse({ description: "Forwarded to the admin", schema: { example: { success: true, forwarded: true, approvalId: "512" } } }),
        ApiResponse({ status: 403, description: "Member is not in your store (`users.errors.notYourStore`)", schema: errorSchema(403, "Forbidden", "This user does not belong to your store") }),
        USER_NOT_FOUND,
    );

/** POST /store/team/:id/reject */
export const ApiStoreTeamReject = () =>
    applyDecorators(
        ApiOperation({ summary: "Reject a team member", description: "Requires `user.approve`." }),
        idParam("User", "91"),
        ApiBody({ type: RejectBodyDoc }),
        ApiOkResponse({ description: "Rejected", type: SuccessResponse }),
        ApiResponse({ status: 403, description: "Member is not in your store", schema: errorSchema(403, "Forbidden", "This user does not belong to your store") }),
        USER_NOT_FOUND,
    );

/** PATCH /store/team/:id/status */
export const ApiStoreTeamStatus = () =>
    applyDecorators(
        ApiOperation({ summary: "Enable or disable a team member", description: "Requires `user.approve`. Staff / partners of your store only." }),
        idParam("User", "88"),
        ApiBody({ type: SetStatusBodyDoc }),
        ApiOkResponse({ description: "Status changed", type: StatusChangeResponse }),
        ApiResponse({ status: 403, description: "Member is not in your store", schema: errorSchema(403, "Forbidden", "You are not allowed to perform this action") }),
        USER_NOT_FOUND,
    );

// =====================================================================
// Me: endpoints
// =====================================================================

/** GET /account/profile */
export const ApiMyProfile = () =>
    applyDecorators(
        ApiOperation({ summary: "Get my profile", description: "Any signed-in user. Profile, avatar, settings, wallet balance and counts." }),
        ApiOkResponse({ description: "Profile", type: ProfileResponse }),
    );

/** PATCH /account/profile */
export const ApiUpdateMyProfile = () =>
    applyDecorators(
        ApiOperation({
            summary: "Update my profile and settings",
            description: "Name, email, default language and app settings (theme, notifications). `settings` is merged: send only what changes.",
        }),
        ApiBody({
            type: ProfileBodyDoc,
            examples: {
                profile: { summary: "Name + language", value: { name: "Nusrat Jahan", language: "bn" } },
                theme: { summary: "Dark theme", value: { settings: { theme: "DARK" } } },
                notifications: { summary: "Mute promotions", value: { settings: { notifications: { promotions: false } } } },
            },
        }),
        ApiOkResponse({ description: "Updated profile", type: ProfileResponse }),
        VALIDATION_ERROR('language: language "fr" is not supported (allowed: en, bn)'),
    );

/** PUT /account/avatar */
export const ApiSetMyAvatar = () =>
    applyDecorators(
        ApiOperation({
            summary: "Upload my avatar (add or replace)",
            description:
                "Multipart upload, field `file`. The image becomes your avatar immediately and your previous avatar is " +
                "deleted — every user has exactly one. Avatars never appear in the media library and only you and admins " +
                "can fetch them by id. Resizing finishes in the background: `avatar.status` is PROCESSING and the URLs " +
                "are null until it is READY (poll GET /account/profile or GET /account/media/{id}/status).",
        }),
        ApiConsumes("multipart/form-data"),
        ApiBody({ type: AvatarBodyDoc }),
        ApiOkResponse({ description: "Updated profile", type: ProfileResponse }),
        ApiBadRequestResponse({
            description: causes("Invalid image", [
                "No file / field not named `file` (`media.file.required`)",
                "Not a JPEG / PNG / WebP image (`media.file.unsupported`)",
                "Smaller than 512×512 or larger than the image size limit",
            ]),
            schema: errorSchema(400, "Bad Request", "Unsupported or corrupted file"),
        }),
    );

/** DELETE /account/avatar */
export const ApiRemoveMyAvatar = () =>
    applyDecorators(
        ApiOperation({ summary: "Remove my avatar", description: "Clears the avatar and deletes the image." }),
        ApiOkResponse({ description: "Updated profile", type: ProfileResponse }),
    );

/** GET /account/wallet */
export const ApiMyWallet = () =>
    applyDecorators(
        ApiOperation({ summary: "Get my wallet and balance history", description: "Balance plus the paginated ledger, newest first." }),
        ...PAGE_QUERIES,
        ApiQuery({ name: "type", required: false, enum: WalletTxnType }),
        ApiQuery({ name: "reason", required: false, enum: WalletTxnReason }),
        ApiOkResponse({ description: "Wallet", type: WalletResponse }),
    );

/** POST /account/phone/request-otp */
export const ApiRequestPhoneChange = () =>
    applyDecorators(
        ApiOperation({
            summary: "Start a phone number change",
            description:
                "Sends a code to your CURRENT phone and to the NEW phone. Both codes are needed to confirm, " +
                "proving you hold both numbers. Calling again resends (subject to the OTP cooldown).",
        }),
        ApiBody({ type: PhoneChangeRequestBodyDoc }),
        ApiOkResponse({ description: "Codes sent", type: PhoneChangeRequestResponse }),
        ApiBadRequestResponse({ description: "Invalid phone, or same as current (`users.errors.phoneUnchanged`)", schema: errorSchema(400, "Bad Request", "The new number is the same as the current one.") }),
        ApiConflictResponse({ description: "New phone already used for your role (`users.errors.phoneTaken`)", schema: errorSchema(409, "Conflict", "+8801812345678 is already registered as CUSTOMER.") }),
        ApiResponse({ status: 429, description: "OTP cooldown / daily limit reached", schema: errorSchema(429, "Too Many Requests", "Please wait before requesting another code") }),
    );

/** POST /account/phone/verify */
export const ApiVerifyPhoneChange = () =>
    applyDecorators(
        ApiOperation({ summary: "Confirm the phone number change", description: "Verifies both codes and switches your phone. Returns the updated profile." }),
        ApiBody({ type: PhoneChangeVerifyBodyDoc }),
        ApiOkResponse({ description: "Updated profile", type: ProfileResponse }),
        ApiBadRequestResponse({ description: "No change requested or it expired (`users.errors.phoneChangeNotRequested`)", schema: errorSchema(400, "Bad Request", "Request a phone change first, or the request has expired.") }),
        ApiResponse({ status: 401, description: "A code is wrong or expired (`otp.errors.invalidOtp`)", schema: errorSchema(401, "Unauthorized", "Invalid or expired code") }),
        ApiConflictResponse({ description: "New phone was taken meanwhile", schema: errorSchema(409, "Conflict", "+8801812345678 is already registered as CUSTOMER.") }),
    );

/** GET /app/wishlist */
export const ApiMyWishlist = () =>
    applyDecorators(
        ApiOperation({
            summary: "Get my wishlist",
            description: "Customers. Newest first. Send `storeId` (the store serving the customer) to get price and stock there.",
        }),
        ...PAGE_QUERIES,
        ApiQuery({ name: "storeId", required: false, type: String, example: "7" }),
        ApiOkResponse({ description: "Wishlist", type: WishlistResponse }),
    );

/** GET /app/wishlist/check */
export const ApiWishlistCheck = () =>
    applyDecorators(
        ApiOperation({ summary: "Check which products are wishlisted", description: "Customers. For marking hearts on product lists in one call." }),
        ApiQuery({ name: "productIds", required: true, type: String, example: "512,530,611", description: "Comma separated, max 100" }),
        ApiOkResponse({ description: "Wishlisted subset", type: WishlistCheckResponse }),
        VALIDATION_ERROR("productIds must contain at least 1 elements"),
    );

const PRODUCT_PARAM = ApiParam({ name: "productId", schema: { type: "string", pattern: "^\\d+$" }, example: "512" });

/** PUT /app/wishlist/:productId */
export const ApiAddToWishlist = () =>
    applyDecorators(
        ApiOperation({ summary: "Add a product to my wishlist", description: "Customers. Idempotent: adding twice is fine." }),
        PRODUCT_PARAM,
        ApiOkResponse({ description: "Saved", type: WishlistToggleResponse }),
        ApiNotFoundResponse({ description: "Product not found or not published (`users.errors.productNotFound`)", schema: errorSchema(404, "Not Found", "Product not found") }),
        ApiConflictResponse({ description: "Wishlist is full (`users.errors.wishlistFull`)", schema: errorSchema(409, "Conflict", "Your wishlist is full (500 items).") }),
    );

/** DELETE /app/wishlist/:productId */
export const ApiRemoveFromWishlist = () =>
    applyDecorators(
        ApiOperation({ summary: "Remove a product from my wishlist", description: "Customers. Idempotent." }),
        PRODUCT_PARAM,
        ApiOkResponse({ description: "Removed", type: WishlistToggleResponse }),
    );

// =====================================================================
// Customer addresses: endpoints
// =====================================================================

const ADDRESS_ERRORS = ApiBadRequestResponse({
    description: causes("Invalid address", [
        "Body validation failed (bad phone, coordinates …)",
        "Country not in ADDRESS_COUNTRIES (`address.errors.unsupportedCountry`)",
        "Unknown state / division (`address.errors.invalidRegion`)",
        "District missing or not in that division (`address.errors.regionRequired` / `invalidSubRegion`)",
        "Postcode missing or invalid for the country (`address.errors.postcodeRequired` / `invalidPostcode`)",
    ]),
    schema: errorSchema(400, "Bad Request", "Select a valid District in Dhaka."),
});

/** GET /app/addresses/format */
export const ApiAddressFormat = () =>
    applyDecorators(
        ApiOperation({
            summary: "Get the address form format",
            description: "Allowed countries with cascading regions (state/division → district) and postcode rules. Cache on the client.",
        }),
        ApiOkResponse({ description: "Address format", type: AddressFormatResponse }),
    );

/** GET /app/addresses */
export const ApiListAddresses = () =>
    applyDecorators(
        ApiOperation({ summary: "List my addresses", description: "Default first, then newest." }),
        ApiOkResponse({ description: "Addresses", type: AddressResponse, isArray: true }),
    );

/** POST /app/addresses */
export const ApiCreateAddress = () =>
    applyDecorators(
        ApiOperation({ summary: "Add an address", description: "Validated per country. The first address becomes the default. Max 20." }),
        ApiBody({ type: AddressBodyDoc }),
        ApiCreatedResponse({ description: "Created", type: AddressResponse }),
        ADDRESS_ERRORS,
        ApiConflictResponse({ description: "Address limit reached (`users.errors.addressLimitReached`)", schema: errorSchema(409, "Conflict", "You can save up to 20 addresses.") }),
    );

/** PUT /app/addresses/:id */
export const ApiUpdateAddress = () =>
    applyDecorators(
        ApiOperation({ summary: "Replace an address", description: "Full replace, validated per country. Omitting `isDefault` keeps the current default flag." }),
        idParam("Address", "77"),
        ApiBody({ type: AddressBodyDoc }),
        ApiOkResponse({ description: "Updated", type: AddressResponse }),
        ADDRESS_ERRORS,
        ApiNotFoundResponse({ description: "Address not found (`users.errors.addressNotFound`)", schema: errorSchema(404, "Not Found", "Address not found") }),
    );

/** DELETE /app/addresses/:id */
export const ApiDeleteAddress = () =>
    applyDecorators(
        ApiOperation({ summary: "Delete an address", description: "Deleting the default promotes the newest remaining address." }),
        idParam("Address", "77"),
        ApiOkResponse({ description: "Deleted", type: SuccessResponse }),
        ApiNotFoundResponse({ description: "Address not found (`users.errors.addressNotFound`)", schema: errorSchema(404, "Not Found", "Address not found") }),
    );

// =====================================================================
// Store team: add / edit staff
// =====================================================================

export class UpdateStaffBodyDoc {
    @ApiPropertyOptional({ enum: ["PACKING", "SUPPORT", "INVENTORY"], isArray: true, example: ["PACKING", "SUPPORT"], description: "Staff duties (drive permissions)" })
    duties?: string[];

    @ApiPropertyOptional({ example: "Rafiq H." })
    name?: string;

    @ApiPropertyOptional({ type: String, nullable: true, example: null, description: "null clears it" })
    email?: string | null;

    @ApiPropertyOptional({ example: "en" })
    language?: string;
}

export class HoldBodyDoc {
    @ApiProperty({ enum: ["FULL", "PARTIAL"], example: "PARTIAL" })
    scope!: string;

    @ApiPropertyOptional({ enum: ["ORDERS", "WITHDRAWAL", "KYC_UPDATE", "SUPPORT", "INVENTORY", "PROFILE_UPDATE"], isArray: true, example: ["WITHDRAWAL"] })
    restrictions?: string[];

    @ApiProperty({ example: "Cash mismatch under review" })
    note!: string;
}

export class ReleaseHoldBodyDoc {
    @ApiPropertyOptional({ example: "Cash reconciled" })
    note?: string;
}

export class TeamMemberDetailResponse extends TeamMemberResponse {
    @ApiProperty({ type: String, nullable: true, example: "rafiq@example.com" })
    email!: string | null;

    @ApiProperty({ example: "bn" })
    language!: string;

    @ApiProperty({ type: String, nullable: true, example: null })
    statusReason!: string | null;

    @ApiProperty({ ...BIGINT_ID, example: "7" })
    storeId!: string;

    @ApiProperty({ ...DATE, nullable: true })
    lastLoginAt!: string | null;

    @ApiProperty(DATE)
    createdAt!: string;
}

const STAFF_EXAMPLE = {
    id: "120",
    phone: "+8801812345678",
    name: "Rafiq Hasan",
    email: "rafiq@example.com",
    language: "bn",
    role: "STORE_STAFF",
    status: "ACTIVE",
    statusReason: null,
    approvalStatus: "APPROVED",
    storeId: "7",
    lastLoginAt: null,
    createdAt: "2026-10-20T04:00:00.000Z",
    partnerProfile: null,
};

/** POST /store/team */
export const ApiStoreTeamCreate = () =>
    applyDecorators(
        ApiOperation({
            summary: "Add a staff member or delivery partner (needs admin approval)",
            description:
                "Requires `user.create`. Upload the KYC files first (`POST /account/media`, purpose `KYC`) and send them in `kyc`. The account is " +
                "created PENDING with a MEMBER_ONBOARDING request for the admin; it can sign in only after approval. KYC is mandatory: " +
                "staff = SELFIE + one of NID / PASSPORT / DRIVING_LICENSE; delivery partner = the same (+ DRIVING_LICENSE and VEHICLE_RC for motor vehicles); " +
                "OTHER documents (with `title`) are optional extras.\n\n" +
                "`submit: true` (default): the KYC set must be complete; it is submitted and the sign-up goes to the admin now. " +
                "`submit: false`: the member is created with KYC **drafts** (any or none) — preview, replace and delete them at `/store/team/{id}/kyc`, " +
                "then `POST /store/team/{id}/kyc/submit` sends the sign-up (`approvalId` is null until then). " +
                "After submitting, the store can't open the KYC files (only their status and forensic flags).",
        }),
        ApiBody({
            type: CreateTeamMemberDto,
            examples: {
                staff: {
                    summary: "Picker",
                    value: {
                        role: "STORE_STAFF", phone: "+8801812345678", name: "Rafiq Hasan", duties: ["PACKING"],
                        kyc: [{ type: "SELFIE", frontMediaId: 9101 }, { type: "NID", documentNumber: "1990123456789", frontMediaId: 9102, backMediaId: 9103 }],
                    },
                },
                draft: {
                    summary: "Save KYC as draft, finish later",
                    value: { role: "STORE_STAFF", phone: "+8801812345679", name: "Sumon", duties: ["SUPPORT"], submit: false, kyc: [{ type: "SELFIE", frontMediaId: 9111 }] },
                },
                rider: {
                    summary: "Delivery partner on a bike",
                    value: {
                        role: "DELIVERY_PARTNER", phone: "+8801912000111", name: "Karim", vehicleType: "BIKE", vehicleNumber: "DHAKA-HA-12-3456",
                        kyc: [
                            { type: "SELFIE", frontMediaId: 9201 },
                            { type: "NID", documentNumber: "1990123456780", frontMediaId: 9202, backMediaId: 9203 },
                            { type: "DRIVING_LICENSE", frontMediaId: 9204, expiresAt: "2030-01-01" },
                            { type: "VEHICLE_RC", frontMediaId: 9205 },
                            { type: "OTHER", title: "Police clearance certificate", frontMediaId: 9206 },
                        ],
                        note: "Referred by Rafiq",
                    },
                },
            },
        }),
        ApiCreatedResponse({
            description: "Pending member",
            example: {
                ...STAFF_EXAMPLE,
                approvalStatus: "PENDING",
                staffDuties: ["PACKING"],
                hold: null,
                kyc: { status: "PENDING", drafts: 0, missing: [], missingSubmitted: [], missingVerified: ["SELFIE", "ONE_OF:NID|PASSPORT|DRIVING_LICENSE"] },
                onboarding: { id: "401", status: "PENDING", reviewNote: null, createdAt: "2026-10-23T04:00:00.000Z", reviewedAt: null },
                approvalId: "401",
            },
        }),
        ApiBadRequestResponse({
            description: causes("Invalid", ["KYC set incomplete (code KYC_DOCS_MISSING, `missing` lists what is needed)", "KYC media not yours / not purpose KYC (code KYC_MEDIA_INVALID)", "`duties` sent for a delivery partner (code DUTIES_STAFF_ONLY)"]),
            schema: errorSchema(400, "Bad Request", "KYC documents missing: VEHICLE_RC"),
        }),
        ApiConflictResponse({ description: "Phone already registered for that role (code PHONE_TAKEN)", schema: errorSchema(409, "Conflict", "+8801812345678 is already registered as STORE_STAFF.") }),
    );

const HOLD_EXAMPLE = {
    success: true,
    hold: { scope: "PARTIAL", restrictions: ["WITHDRAWAL", "KYC_UPDATE"], level: "STORE", byId: "12", byRole: "STORE_MANAGER", note: "Cash mismatch under review", at: "2026-10-23T05:00:00.000Z" },
};

/** POST /admin/users/:id/hold and /store/team/:id/hold */
export const ApiHoldUser = (who: "admin" | "store") =>
    applyDecorators(
        ApiOperation({
            summary: who === "admin" ? "Hold / suspend any account" : "Hold a staff member or delivery partner",
            description:
                (who === "admin"
                    ? "Requires `user.block`. ADMIN-level hold: only an admin can change or lift it. "
                    : "Requires `user.hold`. STORE-level hold on your own team. Refused while an admin hold is in place (code HELD_BY_ADMIN). ") +
                "FULL = account suspended, all sessions signed out. PARTIAL = the account keeps working except the listed capabilities " +
                "(ORDERS: go online / accept / deliver / pack, WITHDRAWAL, KYC_UPDATE, SUPPORT, INVENTORY, PROFILE_UPDATE); blocked calls " +
                "return 403 ACCOUNT_RESTRICTED with your note.",
        }),
        idParam("User", "120"),
        ApiBody({
            type: HoldBodyDoc,
            examples: {
                full: { summary: "Suspend", value: { scope: "FULL", note: "Repeated late deliveries" } },
                partial: { summary: "Freeze withdrawals & KYC edits", value: { scope: "PARTIAL", restrictions: ["WITHDRAWAL", "KYC_UPDATE"], note: "Cash mismatch under review" } },
            },
        }),
        ApiOkResponse({ description: "Hold applied", schema: { example: HOLD_EXAMPLE } }),
        ApiResponse({ status: 403, description: "Not manageable by you / held by admin (code HELD_BY_ADMIN)", schema: errorSchema(403, "Forbidden", "This account was put on hold by an admin. Only an admin can change it.") }),
        USER_NOT_FOUND,
    );

/** POST /admin/users/:id/release and /store/team/:id/release */
export const ApiReleaseUser = (who: "admin" | "store") =>
    applyDecorators(
        ApiOperation({
            summary: "Lift a hold",
            description:
                who === "admin"
                    ? "Requires `user.block`. Lifts any hold."
                    : "Requires `user.hold`. Only holds the store placed; an admin hold returns 403 HELD_BY_ADMIN.",
        }),
        idParam("User", "120"),
        ApiBody({ type: ReleaseHoldBodyDoc, required: false }),
        ApiOkResponse({ description: "Released", schema: { example: { success: true, hold: null } } }),
        ApiResponse({ status: 403, description: "Admin hold", schema: errorSchema(403, "Forbidden", "This account was put on hold by an admin. Only an admin can change it.") }),
        USER_NOT_FOUND,
    );

/** Work history: GET /store/team/:id/activity, /admin/users/:id/activity, /account/work-history */
export const ApiWorkHistory = (who: "member" | "admin" | "self") =>
    applyDecorators(
        ApiOperation({
            summary: who === "self" ? "My work history" : "Work history of a member",
            description:
                "Built from what the work already records — no extra rows: order status changes, items picked, orders packed, support " +
                "replies / notes, stock movements, deliveries and audited actions. `summary` counts each kind in the window (default 30 days). " +
                "Filter `kind` = ORDER | PICK | PACK | SUPPORT | STOCK | DELIVERY | ACTION.",
        }),
        ...(who === "self" ? [] : [idParam("User", "120")]),
        ApiOkResponse({
            description: "History",
            schema: {
                example: {
                    from: "2026-09-23", to: "2026-10-23",
                    summary: [{ kind: "ITEM_PICKED", count: 412, qty: 980 }, { kind: "ORDER_PACKED", count: 160, qty: null }, { kind: "SUPPORT_REPLY", count: 22, qty: null }],
                    items: [
                        { group: "PACK", kind: "ORDER_PACKED", at: "2026-10-23T06:10:00.000Z", refType: "Order", refId: "5501", detail: "QC-261023-A1B2C3", qty: null },
                        { group: "PICK", kind: "ITEM_PICKED", at: "2026-10-23T06:08:00.000Z", refType: "Order", refId: "5501", detail: "AMUL-500", qty: 2 },
                    ],
                    total: 594, page: 1, limit: 20,
                },
            },
        }),
    );

/** GET /store/team/:id */
export const ApiStoreTeamGet = () =>
    applyDecorators(
        ApiOperation({ summary: "Get one team member", description: "Requires `user.read`. Staff / delivery partners of your store only." }),
        idParam("User", "120"),
        ApiOkResponse({ description: "Member", type: TeamMemberDetailResponse, example: STAFF_EXAMPLE }),
        USER_NOT_FOUND,
    );

/** PATCH /store/team/:id */
export const ApiStoreTeamUpdate = () =>
    applyDecorators(
        ApiOperation({ summary: "Edit a staff member", description: "Requires `user.update`. Name, email and language of STORE_STAFF in your store. Phone / role cannot change here." }),
        idParam("User", "120"),
        ApiBody({ type: UpdateStaffBodyDoc, examples: { rename: { summary: "Rename", value: { name: "Rafiq H." } }, clearEmail: { summary: "Clear email", value: { email: null } } } }),
        ApiOkResponse({ description: "Updated member", type: TeamMemberDetailResponse, example: { ...STAFF_EXAMPLE, name: "Rafiq H." } }),
        ApiResponse({ status: 403, description: "Member is a delivery partner (`users.errors.forbidden`)", schema: errorSchema(403, "Forbidden", "You are not allowed to perform this action") }),
        USER_NOT_FOUND,
    );
