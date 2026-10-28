import { PageQueryDto } from "@common/dto/page-query.dto";
import { HoldRestriction } from "@common/authorization/permissions";
import {
    ApprovalStatus,
    StaffDuty,
    UserRole,
    UserStatus,
    VehicleType,
    WalletTxnReason,
    WalletTxnType,
} from "@prisma-client/enums";
import { KycDocInput } from "@modules/kyc/kyc.types";

/** Plain input types of the users services (no decorators; the HTTP DTOs in src/api implement them). */


/** Roles that sign in with phone + password (+ OTP challenge). */
export const PASSWORD_ROLES: readonly UserRole[] = [UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.STORE_MANAGER];

/** Roles that must belong to a store. */
export const STORE_REQUIRED_ROLES: readonly UserRole[] = [UserRole.STORE_MANAGER, UserRole.STORE_STAFF];

/** Roles that may belong to a store. */
export const STORE_ROLES: readonly UserRole[] = [...STORE_REQUIRED_ROLES, UserRole.DELIVERY_PARTNER];

/** Roles only a SUPER_ADMIN may create, edit or delete. */
export const PRIVILEGED_ROLES: readonly UserRole[] = [UserRole.SUPER_ADMIN, UserRole.ADMIN];

export const USER_SORTS = ["newest", "oldest", "name_asc", "name_desc", "last_login"] as const;

export const THEMES = ["LIGHT", "DARK", "SYSTEM"] as const;

export interface AdminCreateUserInput {
    role: UserRole;
    /** E.164, from PHONE_ALLOWED_COUNTRIES. Unique per role. */
    phone: string;
    name: string;
    email?: string;
    language?: string;
    /** Required for ADMIN, SUPER_ADMIN and STORE_MANAGER (password login). */
    password?: string;
    /** Required for STORE_MANAGER / STORE_STAFF, optional for DELIVERY_PARTNER. */
    storeId?: number;
    /** Required for ADMIN: the access role that grants its permissions. */
    accessRoleId?: number;
}

/** Partial edit. Role cannot change (it is part of the login identity). */
export interface AdminUpdateUserInput {
    phone?: string;
    name?: string;
    /** null clears it. */
    email?: string | null;
    language?: string;
    /** Password roles only. Signs the user out everywhere. */
    password?: string;
    /** Store roles only. A number assigns / moves; null removes the user from their store. */
    storeId?: number | null;
    /** ADMIN only. */
    accessRoleId?: number;
}

export interface AdminUserListInput extends PageQueryDto {
    role?: UserRole;
    status?: UserStatus;
    /** PENDING lists users waiting for approval. */
    approvalStatus?: ApprovalStatus;
    storeId?: number;
    /** Name, phone or email. */
    q?: string;
    sort?: (typeof USER_SORTS)[number];
}

export interface AccessRoleInput {
    code: string;
    name: string;
    permissions: string[];
    isActive?: boolean;
}

export interface WalletInput extends PageQueryDto {
    type?: WalletTxnType;
    reason?: WalletTxnReason;
}

export interface WalletAdjustInput {
    type: WalletTxnType;
    amount: number;
    /** Shown in the user's wallet history. */
    note: string;
    /** Retry-safe: the same key never applies twice. */
    idempotencyKey?: string;
}

export interface NotificationSettingsInput {
    orderUpdates?: boolean;
    promotions?: boolean;
    push?: boolean;
    sms?: boolean;
    email?: boolean;
}

export interface SettingsInput {
    theme?: (typeof THEMES)[number];
    notifications?: NotificationSettingsInput;
}

export interface ProfileInput {
    name?: string;
    /** null clears it. */
    email?: string | null;
    /** App / notification language; one of LANGUAGES. */
    language?: string;
    /** Merged into the saved settings: send only what changes. */
    settings?: SettingsInput;
}

export interface PhoneChangeVerifyInput {
    /** Code sent to the current phone. */
    currentPhoneCode: string;
    /** Code sent to the new phone. */
    newPhoneCode: string;
    deviceId?: string;
}

export interface WishlistInput extends PageQueryDto {
    /** Adds that store's price and stock to each item. */
    storeId?: number;
}

export interface AddressInput {
    label?: string;
    receiverName: string;
    receiverPhone: string;
    /** One of ADDRESS_COUNTRIES (GET /app/addresses/format). */
    countryCode: string;
    /** Level-1 region code (state / division); a name is also accepted. */
    stateCode: string;
    /** Level-2 region code; required when the level-1 region has children. */
    districtCode?: string | null;
    city: string;
    line1: string;
    line2?: string;
    landmark?: string;
    /** Validated with the country's postcode rule. */
    pincode?: string;
    latitude: number;
    longitude: number;
    placeId?: string;
    isDefault?: boolean;
}

/** Roles a store manager may list: only their own team. */
export const STORE_TEAM_ROLES = [UserRole.STORE_STAFF, UserRole.DELIVERY_PARTNER] as const;

/**
 * POST store/team — store manager adds a staff member or delivery partner.
 * KYC documents are mandatory; the account stays PENDING until an admin
 * approves the MEMBER_ONBOARDING request.
 */
export interface CreateTeamMemberInput {
    role: (typeof STORE_TEAM_ROLES)[number];
    /** E.164, from PHONE_ALLOWED_COUNTRIES. Unique per role. */
    phone: string;
    name: string;
    email?: string;
    language?: string;
    duties?: StaffDuty[];
    vehicleType?: VehicleType;
    vehicleNumber?: string;
    kyc?: KycDocInput[];
    submit?: boolean;
    note?: string;
}

/** PATCH store/team/:id — details and duties of a STORE_STAFF member. */
export interface UpdateStaffInput {
    name?: string;
    /** null clears it. */
    email?: string | null;
    language?: string;
    duties?: StaffDuty[];
}

/** Put an account on hold. FULL = everything stops (status SUSPENDED); PARTIAL = only the listed capabilities. */
export interface HoldInput {
    scope: "FULL" | "PARTIAL";
    restrictions?: HoldRestriction[];
    note: string;
}

export const ACTIVITY_KINDS = ["ORDER", "PICK", "PACK", "SUPPORT", "STOCK", "DELIVERY", "ACTION"] as const;

/** Work history filters. */
export interface ActivityInput extends PageQueryDto {
    from?: string;
    to?: string;
    kind?: (typeof ACTIVITY_KINDS)[number];
}
