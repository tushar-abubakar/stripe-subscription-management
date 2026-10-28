import {
    PASSWORD_ROLES,
    STORE_REQUIRED_ROLES,
    USER_SORTS,
    THEMES,
    STORE_TEAM_ROLES,
    ACTIVITY_KINDS,
    AdminCreateUserInput,
    AdminUpdateUserInput,
    AdminUserListInput,
    AccessRoleInput,
    WalletInput,
    WalletAdjustInput,
    NotificationSettingsInput,
    SettingsInput,
    ProfileInput,
    PhoneChangeVerifyInput,
    WishlistInput,
    AddressInput,
    CreateTeamMemberInput,
    UpdateStaffInput,
    HoldInput,
    ActivityInput,
} from "@modules/users/users.types";
import { PhoneField } from "@common/decorators/phone.decorator";
import { PageQueryDto } from "@common/dto/page-query.dto";
import {
    IsSupportedLanguage,
} from "@common/validators/is-supported-language.validator";
import {
    HOLD_RESTRICTIONS,
    HoldRestriction,
} from "@common/authorization/permissions";
import { KycDocDto } from "../../store/kyc/kyc.dto";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
    ApprovalStatus,
    StaffDuty,
    UserRole,
    UserStatus,
    VehicleType,
    WalletTxnReason,
    WalletTxnType,
} from "@prisma-client/enums";
import { Transform, Type } from "class-transformer";
import {
    ArrayMaxSize,
    ArrayMinSize,
    ArrayNotEmpty,
    ArrayUnique,
    IsArray,
    IsBoolean,
    IsDateString,
    IsEmail,
    IsEnum,
    IsIn,
    IsInt,
    IsLatitude,
    IsLongitude,
    IsNumber,
    IsOptional,
    IsString,
    Length,
    Matches,
    MaxLength,
    Min,
    MinLength,
    ValidateIf,
    ValidateNested,
} from "class-validator";

const Trim = () => Transform(({ value }) => (typeof value === "string" ? value.trim() : value));
const Lower = () => Transform(({ value }) => (typeof value === "string" ? value.trim().toLowerCase() : value));
const Upper = () => Transform(({ value }) => (typeof value === "string" ? value.trim().toUpperCase() : value));

// ─── Admin: users ─────────────────────────────────────────────────────────────

export class AdminCreateUserDto implements AdminCreateUserInput {
    @IsEnum(UserRole)
    role: UserRole;

    /** E.164, from PHONE_ALLOWED_COUNTRIES. Unique per role. */
    @PhoneField()
    phone: string;

    @Trim()
    @IsString()
    @MinLength(1)
    @MaxLength(120)
    name: string;

    @IsOptional()
    @Trim()
    @IsEmail()
    @MaxLength(191)
    email?: string;

    @IsOptional()
    @Lower()
    @IsSupportedLanguage()
    language?: string;

    /** Required for ADMIN, SUPER_ADMIN and STORE_MANAGER (password login). */
    @ValidateIf((dto: AdminCreateUserDto) => PASSWORD_ROLES.includes(dto.role))
    @IsString()
    @MinLength(8)
    @MaxLength(100)
    password?: string;

    /** Required for STORE_MANAGER / STORE_STAFF, optional for DELIVERY_PARTNER. */
    @ValidateIf(
        (dto: AdminCreateUserDto) => STORE_REQUIRED_ROLES.includes(dto.role) || dto.storeId !== undefined,
    )
    @Type(() => Number)
    @IsInt()
    storeId?: number;

    /** Required for ADMIN: the access role that grants its permissions. */
    @ValidateIf((dto: AdminCreateUserDto) => dto.role === UserRole.ADMIN || dto.accessRoleId !== undefined)
    @Type(() => Number)
    @IsInt()
    accessRoleId?: number;
}

/** Partial edit. Role cannot change (it is part of the login identity). */
export class AdminUpdateUserDto implements AdminUpdateUserInput {
    @IsOptional()
    @PhoneField()
    phone?: string;

    @IsOptional()
    @Trim()
    @IsString()
    @MinLength(1)
    @MaxLength(120)
    name?: string;

    /** null clears it. */
    @IsOptional()
    @Trim()
    @IsEmail()
    @MaxLength(191)
    email?: string | null;

    @IsOptional()
    @Lower()
    @IsSupportedLanguage()
    language?: string;

    /** Password roles only. Signs the user out everywhere. */
    @IsOptional()
    @IsString()
    @MinLength(8)
    @MaxLength(100)
    password?: string;

    /** Store roles only. A number assigns / moves; null removes the user from their store. */
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    storeId?: number | null;

    /** ADMIN only. */
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    accessRoleId?: number;
}

export class AdminUserListQuery extends PageQueryDto implements AdminUserListInput {
    @IsOptional()
    @IsEnum(UserRole)
    role?: UserRole;

    @IsOptional()
    @IsEnum(UserStatus)
    status?: UserStatus;

    /** PENDING lists users waiting for approval. */
    @IsOptional()
    @IsEnum(ApprovalStatus)
    approvalStatus?: ApprovalStatus;

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    storeId?: number;

    /** Name, phone or email. */
    @IsOptional()
    @Trim()
    @IsString()
    @MaxLength(100)
    q?: string;

    @IsOptional()
    @IsIn(USER_SORTS)
    sort?: (typeof USER_SORTS)[number];
}

export class SetStatusDto {
    /** ACTIVE re-enables; SUSPENDED / BLOCKED disable and sign the user out. */
    @IsEnum(UserStatus)
    status: UserStatus;

    @IsOptional()
    @Trim()
    @IsString()
    @MaxLength(255)
    reason?: string;
}

export class RejectDto {
    @Trim()
    @IsString()
    @MinLength(1)
    @MaxLength(255)
    reason: string;
}

export class UnblockOtpDto {
    @PhoneField()
    phone: string;

    @IsEnum(UserRole)
    role: UserRole;
}

export class AccessRoleDto implements AccessRoleInput {
    @IsString()
    @MaxLength(50)
    code: string;

    @IsString()
    @MaxLength(100)
    name: string;

    @IsArray()
    @ArrayNotEmpty()
    @IsString({ each: true })
    permissions: string[];

    @IsOptional()
    @IsBoolean()
    isActive?: boolean;
}

// ─── Wallet ───────────────────────────────────────────────────────────────────

export class WalletQuery extends PageQueryDto implements WalletInput {
    @IsOptional()
    @IsEnum(WalletTxnType)
    type?: WalletTxnType;

    @IsOptional()
    @IsEnum(WalletTxnReason)
    reason?: WalletTxnReason;
}

export class WalletAdjustDto implements WalletAdjustInput {
    @IsIn([WalletTxnType.CREDIT, WalletTxnType.DEBIT])
    type: WalletTxnType;

    @IsNumber({ maxDecimalPlaces: 2 })
    @Min(0.01)
    amount: number;

    /** Shown in the user's wallet history. */
    @Trim()
    @IsString()
    @MinLength(1)
    @MaxLength(255)
    note: string;

    /** Retry-safe: the same key never applies twice. */
    @IsOptional()
    @IsString()
    @Matches(/^[A-Za-z0-9_-]{8,48}$/)
    idempotencyKey?: string;
}

// ─── Me: profile, settings, avatar, phone ─────────────────────────────────────

export class NotificationSettingsDto implements NotificationSettingsInput {
    @IsOptional()
    @IsBoolean()
    orderUpdates?: boolean;

    @IsOptional()
    @IsBoolean()
    promotions?: boolean;

    @IsOptional()
    @IsBoolean()
    push?: boolean;

    @IsOptional()
    @IsBoolean()
    sms?: boolean;

    @IsOptional()
    @IsBoolean()
    email?: boolean;
}

export class SettingsDto implements SettingsInput {
    @IsOptional()
    @Upper()
    @IsIn(THEMES)
    theme?: (typeof THEMES)[number];

    @IsOptional()
    @ValidateNested()
    @Type(() => NotificationSettingsDto)
    notifications?: NotificationSettingsDto;
}

export class ProfileDto implements ProfileInput {
    @IsOptional()
    @Trim()
    @IsString()
    @MinLength(1)
    @MaxLength(120)
    name?: string;

    /** null clears it. */
    @IsOptional()
    @Trim()
    @IsEmail()
    @MaxLength(191)
    email?: string | null;

    /** App / notification language; one of LANGUAGES. */
    @IsOptional()
    @Lower()
    @IsSupportedLanguage()
    language?: string;

    /** Merged into the saved settings: send only what changes. */
    @IsOptional()
    @ValidateNested()
    @Type(() => SettingsDto)
    settings?: SettingsDto;
}

export class PhoneChangeRequestDto {
    @PhoneField()
    newPhone: string;
}

export class PhoneChangeVerifyDto implements PhoneChangeVerifyInput {
    /** Code sent to the current phone. */
    @Matches(/^\d{6}$/)
    currentPhoneCode: string;

    /** Code sent to the new phone. */
    @Matches(/^\d{6}$/)
    newPhoneCode: string;

    @IsOptional()
    @IsString()
    @MaxLength(100)
    deviceId?: string;
}

// ─── Me: wishlist ─────────────────────────────────────────────────────────────

export class WishlistQuery extends PageQueryDto implements WishlistInput {
    /** Adds that store's price and stock to each item. */
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    storeId?: number;
}

export class WishlistCheckQuery {
    /** Comma separated: `?productIds=12,15,40` (max 100). */
    @Transform(({ value }) =>
        (Array.isArray(value) ? value : String(value ?? "").split(","))
            .map((id: string) => String(id).trim())
            .filter(Boolean),
    )
    @IsArray()
    @ArrayMinSize(1)
    @ArrayMaxSize(100)
    @Matches(/^\d+$/, { each: true })
    productIds: string[];
}

// ─── Customer addresses ───────────────────────────────────────────────────────

export class AddressDto implements AddressInput {
    @IsOptional()
    @Trim()
    @IsString()
    @MaxLength(40)
    label?: string;

    @Trim()
    @IsString()
    @MinLength(1)
    @MaxLength(120)
    receiverName: string;

    @PhoneField()
    receiverPhone: string;

    /** One of ADDRESS_COUNTRIES (GET /app/addresses/format). */
    @Upper()
    @IsString()
    @Length(2, 2)
    countryCode: string;

    /** Level-1 region code (state / division); a name is also accepted. */
    @Trim()
    @IsString()
    @MaxLength(100)
    stateCode: string;

    /** Level-2 region code; required when the level-1 region has children. */
    @IsOptional()
    @Trim()
    @IsString()
    @MaxLength(100)
    districtCode?: string | null;

    @Trim()
    @IsString()
    @MinLength(1)
    @MaxLength(100)
    city: string;

    @Trim()
    @IsString()
    @MinLength(1)
    @MaxLength(255)
    line1: string;

    @IsOptional()
    @Trim()
    @IsString()
    @MaxLength(255)
    line2?: string;

    @IsOptional()
    @Trim()
    @IsString()
    @MaxLength(255)
    landmark?: string;

    /** Validated with the country's postcode rule. */
    @IsOptional()
    @Trim()
    @IsString()
    @MaxLength(12)
    pincode?: string;

    @Type(() => Number)
    @IsLatitude()
    latitude: number;

    @Type(() => Number)
    @IsLongitude()
    longitude: number;

    @IsOptional()
    @IsString()
    @MaxLength(255)
    placeId?: string;

    @IsOptional()
    @IsBoolean()
    isDefault?: boolean;
}

/** `?role=STORE_STAFF|DELIVERY_PARTNER` filter for the team / approval lists. */
/**
 * POST store/team — store manager adds a staff member or delivery partner.
 * KYC documents are mandatory; the account stays PENDING until an admin
 * approves the MEMBER_ONBOARDING request.
 */
export class CreateTeamMemberDto implements CreateTeamMemberInput {
    @ApiProperty({ enum: STORE_TEAM_ROLES, example: UserRole.STORE_STAFF })
    @IsIn(STORE_TEAM_ROLES)
    role: (typeof STORE_TEAM_ROLES)[number];

    /** E.164, from PHONE_ALLOWED_COUNTRIES. Unique per role. */
    @ApiProperty({ example: "+8801812345678" })
    @PhoneField()
    phone: string;

    @ApiProperty({ example: "Rafiq Hasan", maxLength: 120 })
    @Trim()
    @IsString()
    @MinLength(1)
    @MaxLength(120)
    name: string;

    @ApiPropertyOptional({ example: "rafiq@example.com" })
    @IsOptional()
    @Trim()
    @IsEmail()
    @MaxLength(191)
    email?: string;

    @ApiPropertyOptional({ example: "bn" })
    @IsOptional()
    @Lower()
    @IsSupportedLanguage()
    language?: string;

    @ApiPropertyOptional({
        enum: StaffDuty,
        isArray: true,
        example: [StaffDuty.PACKING],
        description: "STORE_STAFF only: what they work on (PACKING / SUPPORT / INVENTORY). Drives their permissions.",
    })
    @IsOptional()
    @IsArray()
    @ArrayUnique()
    @IsEnum(StaffDuty, { each: true })
    duties?: StaffDuty[];

    @ApiPropertyOptional({ enum: VehicleType, example: VehicleType.BIKE, description: "Required for DELIVERY_PARTNER" })
    @ValidateIf((dto: CreateTeamMemberDto) => dto.role === UserRole.DELIVERY_PARTNER)
    @IsEnum(VehicleType)
    vehicleType?: VehicleType;

    @ApiPropertyOptional({ example: "DHAKA-METRO-HA-12-3456", maxLength: 20 })
    @IsOptional()
    @IsString()
    @MaxLength(20)
    vehicleNumber?: string;

    @ApiPropertyOptional({
        type: () => [KycDocDto],
        maxItems: 20,
        description:
            "Files uploaded by you with purpose KYC. Staff: SELFIE + one of NID / PASSPORT / DRIVING_LICENSE. Delivery partner: the same " +
            "(+ DRIVING_LICENSE and VEHICLE_RC for motor vehicles). OTHER documents (with `title`) are optional extras. " +
            "With `submit: true` the set must be complete; with `submit: false` they are saved as drafts.",
    })
    @IsOptional()
    @IsArray()
    @ArrayMaxSize(20)
    @ValidateNested({ each: true })
    @Type(() => KycDocDto)
    kyc?: KycDocDto[];

    @ApiPropertyOptional({
        example: false,
        default: true,
        description:
            "true: KYC is submitted and the sign-up goes to the admin now (files locked away from the store). " +
            "false: saved as a draft — preview / replace / delete at `/store/team/{id}/kyc`, then `POST /store/team/{id}/kyc/submit`.",
    })
    @IsOptional()
    @IsBoolean()
    submit?: boolean;

    @ApiPropertyOptional({ example: "Joining as evening picker", maxLength: 1000, description: "Note for the admin" })
    @IsOptional()
    @IsString()
    @MaxLength(1000)
    note?: string;
}

/** PATCH store/team/:id — details and duties of a STORE_STAFF member. */
export class UpdateStaffDto implements UpdateStaffInput {
    @ApiPropertyOptional({ example: "Rafiq H." })
    @IsOptional()
    @Trim()
    @IsString()
    @MinLength(1)
    @MaxLength(120)
    name?: string;

    /** null clears it. */
    @ApiPropertyOptional({ type: String, nullable: true, example: null })
    @IsOptional()
    @Trim()
    @IsEmail()
    @MaxLength(191)
    email?: string | null;

    @ApiPropertyOptional({ example: "en" })
    @IsOptional()
    @Lower()
    @IsSupportedLanguage()
    language?: string;

    @ApiPropertyOptional({ enum: StaffDuty, isArray: true, example: [StaffDuty.PACKING, StaffDuty.SUPPORT] })
    @IsOptional()
    @IsArray()
    @ArrayUnique()
    @IsEnum(StaffDuty, { each: true })
    duties?: StaffDuty[];
}

/** Put an account on hold. FULL = everything stops (status SUSPENDED); PARTIAL = only the listed capabilities. */
export class HoldDto implements HoldInput {
    @ApiProperty({ enum: ["FULL", "PARTIAL"], example: "PARTIAL" })
    @IsIn(["FULL", "PARTIAL"])
    scope: "FULL" | "PARTIAL";

    @ApiPropertyOptional({
        enum: HOLD_RESTRICTIONS,
        isArray: true,
        example: ["WITHDRAWAL", "KYC_UPDATE"],
        description: "Required for PARTIAL. ORDERS = go online / accept / deliver / pack; WITHDRAWAL = cash-out; KYC_UPDATE; SUPPORT; INVENTORY; PROFILE_UPDATE.",
    })
    @ValidateIf((dto: HoldDto) => dto.scope === "PARTIAL")
    @IsArray()
    @ArrayMinSize(1)
    @ArrayUnique()
    @IsIn(HOLD_RESTRICTIONS, { each: true })
    restrictions?: HoldRestriction[];

    @ApiProperty({ example: "Cash mismatch on 3 COD orders, under review", maxLength: 255 })
    @Trim()
    @IsString()
    @MinLength(1)
    @MaxLength(255)
    note: string;
}

export class ReleaseHoldDto {
    @ApiPropertyOptional({ example: "Cash reconciled", maxLength: 255 })
    @IsOptional()
    @Trim()
    @IsString()
    @MaxLength(255)
    note?: string;
}

/** Work history filters. */
export class ActivityQuery extends PageQueryDto implements ActivityInput {
    @ApiPropertyOptional({ example: "2026-10-01", format: "date" })
    @IsOptional()
    @IsDateString()
    from?: string;

    @ApiPropertyOptional({ example: "2026-10-23", format: "date", description: "Inclusive" })
    @IsOptional()
    @IsDateString()
    to?: string;

    @ApiPropertyOptional({ enum: ACTIVITY_KINDS })
    @IsOptional()
    @IsIn(ACTIVITY_KINDS)
    kind?: (typeof ACTIVITY_KINDS)[number];
}

export class StoreTeamQuery extends PageQueryDto {
    @IsOptional()
    @IsIn(STORE_TEAM_ROLES)
    role?: (typeof STORE_TEAM_ROLES)[number];
}
