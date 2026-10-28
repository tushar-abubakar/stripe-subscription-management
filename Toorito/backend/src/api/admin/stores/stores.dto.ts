import {
    LatLngInput,
    StoreAreaInput,
    OperationalInput,
    ChargeScheduleInput,
    StoreChargeInput,
    CreateStoreInput,
    UpdateStoreInput,
    CodeCheckQueryInput,
} from "@modules/stores/stores.types";
import { PhoneField } from "@common/decorators/phone.decorator";
import { PageQueryDto } from "@common/dto/page-query.dto";
import { messageKey } from "@common/utils/localeMessage.util";
import { IsLocaleMap } from "@common/validators/is-locale-map.validator";
import type { LocaleMap } from "@core/locale/locale.service";
import {
    ChargeCalc,
    ChargeKind,
    ChargeTrigger,
    CLOCK_PATTERN,
    isOpeningHours,
    OpeningHours,
    STORE_LIMITS,
} from "@modules/stores/stores.util";
import { OmitType, PartialType } from "@nestjs/swagger";
import { StoreServiceMode, StoreStatus } from "@prisma-client/enums";
import { Transform, Type } from "class-transformer";
import {
    ArrayMaxSize,
    ArrayMinSize,
    ArrayUnique,
    IsArray,
    IsBoolean,
    IsEmail,
    IsEnum,
    IsIn,
    IsInt,
    IsLatitude,
    IsLongitude,
    IsNumber,
    IsObject,
    IsOptional,
    IsString,
    Length,
    Matches,
    Max,
    MaxLength,
    Min,
    registerDecorator,
    ValidateIf,
    ValidateNested,
    ValidationOptions,
} from "class-validator";

const money = { maxDecimalPlaces: 2 } as const;

const Trim = () =>
    Transform(({ value }) => (typeof value === "string" ? value.trim() : value));

const Upper = () =>
    Transform(({ value }) => (typeof value === "string" ? value.trim().toUpperCase() : value));

/** `{}` or `{ en: "", bn: " " }` means "no text": treated as not sent. */
const EmptyMapAsUndefined = () =>
    Transform(({ value }) =>
        value &&
        typeof value === "object" &&
        !Array.isArray(value) &&
        Object.values(value).every((text) => text == null || (typeof text === "string" && !text.trim()))
            ? undefined
            : value,
    );

/** `{ mon: [["09:00","23:00"]], ... }` with day keys sun..sat. */
function IsOpeningHours(options?: ValidationOptions) {
    return (object: object, propertyName: string) =>
        registerDecorator({
            name: "isOpeningHours",
            target: object.constructor,
            propertyName,
            options,
            validator: {
                validate: isOpeningHours,
                defaultMessage: (args) =>
                    messageKey("stores.errors.openingHoursInvalid", { property: args?.property }),
            },
        });
}

// ─── Geo ─────────────────────────────────────────────────────────────────────

export class LatLngDto implements LatLngInput {
    @Type(() => Number)
    @IsLatitude()
    lat: number;

    @Type(() => Number)
    @IsLongitude()
    lng: number;
}

export class AreaDto implements StoreAreaInput {
    /**
     * Ignored: areas are replaced as a whole on save. Accepted so the admin
     * UI can send back the areas it received from GET unchanged.
     */
    @IsOptional()
    @Transform(({ value }) => (value == null ? value : String(value)))
    @Matches(/^\d+$/)
    id?: string;

    @Trim()
    @IsString()
    @MaxLength(120)
    name: string;

    /** Google Maps Place ID, if the area was picked from a place. */
    @IsOptional()
    @IsString()
    @MaxLength(255)
    placeId?: string;

    @IsArray()
    @ArrayMinSize(3)
    @ArrayMaxSize(STORE_LIMITS.maxPolygonPoints + 1)
    @ValidateNested({ each: true })
    @Type(() => LatLngDto)
    polygon: LatLngDto[];

    @IsOptional()
    @IsNumber(money)
    @Min(0)
    deliveryFeeOverride?: number;
}

// ─── Unit economics & cart rules (also what a store manager may edit) ────────

export class OperationalDto implements OperationalInput {
    /** Manual open/closed override. */
    @IsOptional()
    @IsBoolean()
    isOpen?: boolean;

    /** "Order accept" switch. */
    @IsOptional()
    @IsBoolean()
    acceptingOrders?: boolean;

    @IsOptional()
    @IsOpeningHours()
    openingHours?: OpeningHours | null;

    @IsOptional()
    @IsInt()
    @Min(0)
    @Max(STORE_LIMITS.maxPrepMinutes)
    avgPrepMinutes?: number;

    @IsOptional()
    @IsNumber(money)
    @Min(0)
    minOrderValue?: number;

    /** Base delivery fee. */
    @IsOptional()
    @IsNumber(money)
    @Min(0)
    deliveryFee?: number;

    /** null = delivery is never free. */
    @IsOptional()
    @IsNumber(money)
    @Min(0)
    freeDeliveryAbove?: number | null;

    @IsOptional()
    @IsNumber(money)
    @Min(0)
    handlingFee?: number;

    /** Carts below this subtotal pay `smallCartFee`. */
    @IsOptional()
    @IsNumber(money)
    @Min(0)
    smallCartLimit?: number | null;

    @IsOptional()
    @IsNumber(money)
    @Min(0)
    smallCartFee?: number | null;

    /** E.164, limited to PHONE_ALLOWED_COUNTRIES. */
    @IsOptional()
    @PhoneField()
    phone?: string | null;
}

export class ChargeScheduleDto implements ChargeScheduleInput {
    /** 0 = Sunday … 6 = Saturday; omit for every day. */
    @IsOptional()
    @IsArray()
    @ArrayUnique()
    @IsInt({ each: true })
    @Min(0, { each: true })
    @Max(6, { each: true })
    days?: number[];

    @Matches(CLOCK_PATTERN)
    from: string;

    @Matches(CLOCK_PATTERN)
    to: string;
}

/** Rain / night / peak surge, packaging, or a custom charge. */
export class StoreChargeDto implements StoreChargeInput {
    /** Echo the id of an existing charge to keep it stable; omit for a new one. */
    @IsOptional()
    @IsString()
    @MaxLength(36)
    id?: string;

    @IsEnum(ChargeKind)
    kind: ChargeKind;

    /** Required for CUSTOM; optional (and `{}` allowed) for the other kinds. */
    @IsOptional()
    @EmptyMapAsUndefined()
    @IsLocaleMap()
    label?: LocaleMap;

    @IsEnum(ChargeCalc)
    calc: ChargeCalc;

    /** FLAT: money. PERCENT: 0–100 of cart subtotal. */
    @IsNumber(money)
    @Min(0)
    amount: number;

    /** PERCENT only: cap in money. */
    @IsOptional()
    @IsNumber(money)
    @Min(0)
    maxAmount?: number;

    @IsEnum(ChargeTrigger)
    trigger: ChargeTrigger;

    @ValidateIf((dto: StoreChargeDto) => dto.trigger === ChargeTrigger.SCHEDULE)
    @IsObject()
    @ValidateNested()
    @Type(() => ChargeScheduleDto)
    schedule?: ChargeScheduleDto;

    /** MANUAL: on/off switch (default off). SCHEDULE: enabled (default on). */
    @IsOptional()
    @IsBoolean()
    isActive?: boolean;
}

/** PUT store/profile/charges — replaces the whole surcharge list. */
export class StoreChargesDto {
    @IsArray()
    @ArrayMaxSize(STORE_LIMITS.maxCharges)
    @ValidateNested({ each: true })
    @Type(() => StoreChargeDto)
    charges: StoreChargeDto[];
}

/** PATCH …/charges/:chargeId — quick on/off (e.g. "it started raining"). */
export class ToggleChargeDto {
    @IsBoolean()
    isActive: boolean;
}

// ─── Create / update ─────────────────────────────────────────────────────────

export class CreateStoreDto extends OperationalDto implements CreateStoreInput {
    // Identity
    @Upper()
    @IsString()
    @Length(2, 30)
    code: string;

    @IsLocaleMap()
    name: LocaleMap;

    @IsOptional()
    @Trim()
    @IsEmail()
    @MaxLength(191)
    email?: string | null;

    @IsOptional()
    @Trim()
    @IsString()
    @MaxLength(60)
    licenseNumber?: string | null;

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    logoId?: number | null;

    /** One of the country's timezones (GET admin/stores/meta). Defaults to the first. */
    @IsOptional()
    @IsString()
    @MaxLength(50)
    timezone?: string;

    /** Defaults to DRAFT. ACTIVE only when the readiness checks pass. */
    @IsOptional()
    @IsEnum(StoreStatus)
    status?: StoreStatus;

    // Address — cascading: country → state/division → district (when the country has one)
    @Upper()
    @IsString()
    @Length(2, 2)
    countryCode: string;

    /** Level-1 region code from meta, e.g. "C" (Dhaka division) or "KA" (Karnataka). */
    @Trim()
    @IsString()
    @MaxLength(100)
    stateCode: string;

    /** Level-2 region code; required when the chosen level-1 region has children. */
    @IsOptional()
    @Trim()
    @IsString()
    @MaxLength(100)
    districtCode?: string | null;

    @Trim()
    @IsString()
    @MaxLength(100)
    city: string;

    @Trim()
    @IsString()
    @MaxLength(255)
    addressLine: string;

    @IsOptional()
    @Trim()
    @IsString()
    @MaxLength(255)
    addressLine2?: string | null;

    /** Validated against the country's postcode rule. */
    @IsOptional()
    @Trim()
    @IsString()
    @MaxLength(12)
    pincode?: string;

    // Pin
    @Type(() => Number)
    @IsLatitude()
    latitude: number;

    @Type(() => Number)
    @IsLongitude()
    longitude: number;

    @IsOptional()
    @IsString()
    @MaxLength(255)
    placeId?: string | null;

    // Delivery boundary
    @IsEnum(StoreServiceMode)
    serviceMode: StoreServiceMode;

    /** RADIUS mode: metres around the pin. */
    // Required in RADIUS mode; validated whenever sent (also on PATCH without serviceMode).
    @ValidateIf((dto: CreateStoreDto) => dto.serviceMode === StoreServiceMode.RADIUS || dto.serviceRadiusM !== undefined)
    @Type(() => Number)
    @IsInt()
    @Min(STORE_LIMITS.serviceRadiusM.min)
    @Max(STORE_LIMITS.serviceRadiusM.max)
    serviceRadiusM?: number;

    /** AREA mode: one or more polygons. Sending this replaces all areas. */
    // Required in AREA mode; validated whenever sent (also on PATCH without serviceMode).
    @ValidateIf((dto: CreateStoreDto) => dto.serviceMode === StoreServiceMode.AREA || dto.areas !== undefined)
    @IsArray()
    @ArrayMinSize(1)
    @ArrayMaxSize(STORE_LIMITS.maxAreas)
    @ValidateNested({ each: true })
    @Type(() => AreaDto)
    areas?: AreaDto[];

    /** Full list; replaces Store.charges. Omit to leave charges unchanged. */
    @IsOptional()
    @IsArray()
    @ArrayMaxSize(STORE_LIMITS.maxCharges)
    @ValidateNested({ each: true })
    @Type(() => StoreChargeDto)
    charges?: StoreChargeDto[];
}

/** Everything optional; `code` is immutable after creation. */
export class UpdateStoreDto extends PartialType(OmitType(CreateStoreDto, ["code"] as const)) implements UpdateStoreInput {}

// ─── Queries ─────────────────────────────────────────────────────────────────

export class ResolveQueryDto extends LatLngDto {}

export class CodeCheckQueryDto implements CodeCheckQueryInput {
    /** Code to check. Omit to only get suggestions. */
    @IsOptional()
    @IsString()
    @MaxLength(60)
    code?: string;

    /** For suggestions, e.g. "Dhaka". */
    @IsOptional()
    @IsString()
    @MaxLength(100)
    city?: string;

    /** Store name in the default language, e.g. "Gulshan Hub Dark Store". */
    @IsOptional()
    @IsString()
    @MaxLength(150)
    name?: string;
}

export class ListStoresQuery extends PageQueryDto {
    @IsOptional()
    @IsEnum(StoreStatus)
    status?: StoreStatus;

    @IsOptional()
    @IsEnum(StoreServiceMode)
    serviceMode?: StoreServiceMode;

    @IsOptional()
    @Upper()
    @IsString()
    @Length(2, 2)
    countryCode?: string;

    /** Name (any language), code, phone or city. */
    @IsOptional()
    @IsString()
    @MaxLength(100)
    q?: string;

    @IsOptional()
    @IsIn(["newest", "oldest", "name_asc", "name_desc", "updated_asc", "updated_desc"])
    sort?: "newest" | "oldest" | "name_asc" | "name_desc" | "updated_asc" | "updated_desc";
}
