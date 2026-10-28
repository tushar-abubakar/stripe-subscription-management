/**
 * Swagger / OpenAPI documentation for the stores module.
 *
 * Everything Swagger-related for stores lives here so the controllers stay
 * readable. Each endpoint gets ONE composed decorator (`@ApiXxx()`) that
 * documents its summary, params, request body (with examples), success
 * response (typed model + example) and every error the service can throw.
 *
 * The classes here are documentation models only; validation stays in
 * `stores.dto.ts`. Bigint ids and Decimal columns are documented as strings
 * because that is how they are serialized over JSON.
 */
import { STORE_LIMITS } from "@modules/stores/stores.util";
import { applyDecorators } from "@nestjs/common";
import {
    ApiBadRequestResponse,
    ApiBearerAuth,
    ApiBody,
    ApiConflictResponse,
    ApiCreatedResponse,
    ApiExtraModels,
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
    PartialType,
} from "@nestjs/swagger";
import { StoreServiceMode, StoreStatus } from "@prisma-client/enums";

// =====================================================================
// Shared schema fragments
// =====================================================================

/** `{ "en": "...", "bn": "..." }` — keys are language codes. */
const LOCALE_MAP = {
    type: "object",
    additionalProperties: { type: "string" },
} as const;

const BIGINT_ID = { type: String, pattern: "^\\d+$" } as const;

/** Prisma Decimal columns are serialized as numeric strings. */
const DECIMAL = { type: String, pattern: "^-?\\d+(\\.\\d+)?$" } as const;

const CHARGE_KINDS = ["RAIN_SURGE", "NIGHT_SURGE", "PEAK_SURGE", "PACKAGING", "CUSTOM"];
const CHARGE_CALCS = ["FLAT", "PERCENT"];
const CHARGE_TRIGGERS = ["MANUAL", "SCHEDULE"];

const OPENING_HOURS_SCHEMA = {
    type: "object",
    nullable: true,
    description:
        "Day key (sun, mon, tue, wed, thu, fri, sat) → up to 4 `[from, to]` ranges in 24h `HH:mm`. " +
        "`to` earlier than `from` means the range runs past midnight. Omitted days are closed.",
    additionalProperties: {
        type: "array",
        items: { type: "array", items: { type: "string" }, minItems: 2, maxItems: 2 },
    },
    example: { mon: [["09:00", "23:00"]], sat: [["08:00", "13:00"], ["16:00", "02:00"]] },
} as const;

/**
 * Standard error body. `message` is translated using Accept-Language.
 * Validation errors (400 from the ValidationPipe) return an array.
 */
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
            code: {
                type: "string",
                example: "SERVICE_RADIUS_REQUIRED",
                description: "Machine-readable code, present on domain errors",
            },
        },
    };
}

/** Builds a "possible causes" list for an error response description. */
function causes(title: string, list: string[]) {
    return `${title}\n\nPossible causes:\n${list.map((c) => `- ${c}`).join("\n")}`;
}

const ACCEPT_LANGUAGE_HEADER = ApiHeader({
    name: "Accept-Language",
    required: false,
    description:
        "Language for localized fields, country names and error messages. Falls back to the default language.",
    example: "en",
});

const ID_PARAM = ApiParam({
    name: "id",
    description: "Store ID (bigint, sent as a numeric string)",
    schema: { type: "string", pattern: "^\\d+$" },
    example: "7",
});

const NOT_FOUND = ApiNotFoundResponse({
    description: "Store not found (`stores.errors.notFound`)",
    schema: errorSchema(404, "Not Found", "Store not found"),
});

// =====================================================================
// Request body models
// =====================================================================

export class LatLngDoc {
    @ApiProperty({ example: 23.7925 })
    lat!: number;

    @ApiProperty({ example: 90.4078 })
    lng!: number;
}

export class StoreAreaBodyDoc {
    @ApiPropertyOptional({
        ...BIGINT_ID,
        example: "31",
        description: "Ignored (areas are replaced as a whole); accepted so a GET response can be sent back unchanged",
    })
    id?: string;

    @ApiProperty({ example: "Gulshan 1 & 2", maxLength: 120 })
    name!: string;

    @ApiPropertyOptional({ example: "ChIJ0wJ3x5bHVTcRQmA2zJr7r3U", description: "Google place id, when picked from a place" })
    placeId?: string;

    @ApiProperty({
        type: () => [LatLngDoc],
        minItems: 3,
        maxItems: STORE_LIMITS.maxPolygonPoints + 1,
        description:
            "Polygon vertices. A closing point equal to the first is optional. Rounded to 6 dp; " +
            `must not cross itself, be at least ${STORE_LIMITS.minAreaM2} m² and stay within ` +
            `${STORE_LIMITS.maxAreaDistanceM / 1000} km of the store pin.`,
    })
    polygon!: LatLngDoc[];

    @ApiPropertyOptional({ example: 35, description: "Delivery fee for this area instead of the store's base fee" })
    deliveryFeeOverride?: number;
}

export class ChargeScheduleDoc {
    @ApiPropertyOptional({
        type: [Number],
        example: [5, 6],
        description: "0 = Sunday … 6 = Saturday; the day the window starts. Omit for every day.",
    })
    days?: number[];

    @ApiProperty({ example: "22:00", description: "24h HH:mm in the store's timezone" })
    from!: string;

    @ApiProperty({ example: "06:00", description: "Earlier than `from` = runs past midnight" })
    to!: string;
}

export class StoreChargeBodyDoc {
    @ApiPropertyOptional({
        example: "a1b2c3d4e5f6",
        description: "Echo the id of an existing charge to keep it stable; omit for a new one",
    })
    id?: string;

    @ApiProperty({ enum: CHARGE_KINDS, example: "RAIN_SURGE", description: "One of each kind per store, except CUSTOM" })
    kind!: string;

    @ApiPropertyOptional({ ...LOCALE_MAP, example: { en: "Rain surge" }, description: "Required for CUSTOM" })
    label?: Record<string, string>;

    @ApiProperty({ enum: CHARGE_CALCS, example: "FLAT" })
    calc!: string;

    @ApiProperty({ example: 20, description: "FLAT: money. PERCENT: 0–100 of the cart subtotal" })
    amount!: number;

    @ApiPropertyOptional({ example: 40, description: "PERCENT only: cap in money" })
    maxAmount?: number;

    @ApiProperty({ enum: CHARGE_TRIGGERS, example: "MANUAL", description: "MANUAL = on/off switch, SCHEDULE = time window" })
    trigger!: string;

    @ApiPropertyOptional({ type: () => ChargeScheduleDoc, description: "Required when trigger is SCHEDULE" })
    schedule?: ChargeScheduleDoc;

    @ApiPropertyOptional({ example: true, description: "MANUAL: the switch (default off). SCHEDULE: enabled (default on)" })
    isActive?: boolean;
}

/** Fields a store manager may also change (PATCH /store/profile). */
export class StoreOperationalBodyDoc {
    @ApiPropertyOptional({ example: true, description: "Manual open/closed override" })
    isOpen?: boolean;

    @ApiPropertyOptional({ example: true, description: "The \"Order accept\" switch" })
    acceptingOrders?: boolean;

    @ApiPropertyOptional(OPENING_HOURS_SCHEMA)
    openingHours?: Record<string, string[][]> | null;

    @ApiPropertyOptional({ example: 8, minimum: 0, maximum: STORE_LIMITS.maxPrepMinutes })
    avgPrepMinutes?: number;

    @ApiPropertyOptional({ example: 99, minimum: 0 })
    minOrderValue?: number;

    @ApiPropertyOptional({ example: 25, minimum: 0, description: "Base delivery fee" })
    deliveryFee?: number;

    @ApiPropertyOptional({ example: 249, nullable: true, description: "null = delivery is never free" })
    freeDeliveryAbove?: number | null;

    @ApiPropertyOptional({ example: 5, minimum: 0 })
    handlingFee?: number;

    @ApiPropertyOptional({ example: 149, nullable: true, description: "Carts below this subtotal pay `smallCartFee`" })
    smallCartLimit?: number | null;

    @ApiPropertyOptional({ example: 15, nullable: true, description: "Requires `smallCartLimit`" })
    smallCartFee?: number | null;

    @ApiPropertyOptional({
        example: "+8801712345678",
        nullable: true,
        description: "E.164, from a country in `phoneCountries` (GET /admin/stores/meta)",
    })
    phone?: string | null;
}

export class StoreCreateBodyDoc extends StoreOperationalBodyDoc {
    @ApiProperty({
        example: "DS-DHK-GLS01",
        description: "Unique, letters/digits/hyphens, 2–30 chars. Upper-cased. Immutable after create.",
    })
    code!: string;

    @ApiProperty({
        ...LOCALE_MAP,
        example: { en: "Gulshan Hub Dark Store", bn: "গুলশান হাব ডার্ক স্টোর" },
        description: "Localized display name; the default language is required",
    })
    name!: Record<string, string>;

    @ApiPropertyOptional({ example: "gulshan@example.com", nullable: true })
    email?: string | null;

    @ApiPropertyOptional({ example: "TRAD/DNCC/012345/2026", nullable: true, description: "Commerce / trade license number" })
    licenseNumber?: string | null;

    @ApiPropertyOptional({ ...BIGINT_ID, example: "88", nullable: true, description: "Media id of the logo" })
    logoId?: string | null;

    @ApiPropertyOptional({
        example: "Asia/Dhaka",
        description: "One of the country's `timezones` from meta. Defaults to its `defaultTimezone`.",
    })
    timezone?: string;

    @ApiPropertyOptional({
        enum: StoreStatus,
        example: StoreStatus.DRAFT,
        description: "Defaults to DRAFT. ACTIVE only when the blocking readiness checks pass.",
    })
    status?: StoreStatus;

    @ApiProperty({ example: "BD", description: "One of the countries in meta (ADDRESS_COUNTRIES)" })
    countryCode!: string;

    @ApiProperty({ example: "C", description: "Level-1 region code from meta (state / division). A name is also accepted." })
    stateCode!: string;

    @ApiPropertyOptional({
        example: "13",
        nullable: true,
        description: "Level-2 region code (district). Required when the chosen level-1 region has `children`.",
    })
    districtCode?: string | null;

    @ApiProperty({ example: "Dhaka", maxLength: 100 })
    city!: string;

    @ApiProperty({ example: "House 12, Road 90, Gulshan 2", maxLength: 255 })
    addressLine!: string;

    @ApiPropertyOptional({ example: "Level 1", nullable: true, maxLength: 255 })
    addressLine2?: string | null;

    @ApiPropertyOptional({ example: "1212", description: "Validated with the country's `postcode.pattern`" })
    pincode?: string;

    @ApiProperty({ example: 23.7925 })
    latitude!: number;

    @ApiProperty({ example: 90.4078 })
    longitude!: number;

    @ApiPropertyOptional({ example: "ChIJ0wJ3x5bHVTcRQmA2zJr7r3U", nullable: true })
    placeId?: string | null;

    @ApiProperty({ enum: StoreServiceMode, example: StoreServiceMode.RADIUS })
    serviceMode!: StoreServiceMode;

    @ApiPropertyOptional({
        example: 3200,
        minimum: STORE_LIMITS.serviceRadiusM.min,
        maximum: STORE_LIMITS.serviceRadiusM.max,
        description: "RADIUS mode: metres around the pin. Required in RADIUS mode.",
    })
    serviceRadiusM?: number;

    @ApiPropertyOptional({
        type: () => [StoreAreaBodyDoc],
        maxItems: STORE_LIMITS.maxAreas,
        description: "AREA mode: one or more polygons. Required in AREA mode; sending it replaces all areas.",
    })
    areas?: StoreAreaBodyDoc[];

    @ApiPropertyOptional({
        type: () => [StoreChargeBodyDoc],
        maxItems: STORE_LIMITS.maxCharges,
        description: "Full list of surcharges; replaces the stored list. Omit to leave unchanged.",
    })
    charges?: StoreChargeBodyDoc[];
}

/** PATCH body: every create field is optional; `code` cannot change. */
export class StoreUpdateBodyDoc extends PartialType(StoreCreateBodyDoc) {}

// =====================================================================
// Response models
// =====================================================================

export class MoneyResponse {
    @ApiProperty({ example: 25 })
    amount!: number;

    @ApiProperty({ example: "BDT" })
    currency!: string;

    @ApiProperty({ example: "৳" })
    symbol!: string;

    @ApiProperty({ example: "৳25.00" })
    formatted!: string;
}

export class CurrencyInfoResponse {
    @ApiProperty({ example: "BDT" })
    code!: string;

    @ApiProperty({ example: "৳" })
    symbol!: string;
}

export class SurchargeResponse {
    @ApiProperty({ example: "a1b2c3d4e5f6" })
    id!: string;

    @ApiProperty({ enum: CHARGE_KINDS, example: "RAIN_SURGE" })
    kind!: string;

    @ApiProperty({ type: String, nullable: true, example: "Rain surge", description: "Localized label" })
    label!: string | null;

    @ApiProperty({ enum: CHARGE_CALCS, example: "FLAT" })
    calc!: string;

    @ApiProperty({
        oneOf: [{ $ref: "#/components/schemas/MoneyResponse" }, { type: "number" }],
        description: "Money object for FLAT, plain percentage (0–100) for PERCENT",
    })
    amount!: MoneyResponse | number;

    @ApiProperty({ type: () => MoneyResponse, nullable: true, description: "PERCENT cap" })
    maxAmount!: MoneyResponse | null;
}

/** GET /app/stores/resolve */
export class StorefrontStoreResponse {
    @ApiProperty({ ...BIGINT_ID, example: "7" })
    id!: string;

    @ApiProperty({ example: "DS-DHK-GLS01" })
    code!: string;

    @ApiProperty({ example: "Gulshan Hub Dark Store", description: "Localized to Accept-Language" })
    name!: string;

    @ApiProperty({ ...DECIMAL, example: "23.7925" })
    latitude!: string;

    @ApiProperty({ ...DECIMAL, example: "90.4078" })
    longitude!: string;

    @ApiProperty({ example: true })
    isOpen!: boolean;

    @ApiProperty({ example: true })
    acceptingOrders!: boolean;

    @ApiProperty({ example: 8 })
    avgPrepMinutes!: number;

    @ApiProperty(OPENING_HOURS_SCHEMA)
    openingHours!: Record<string, string[][]> | null;

    @ApiProperty({ example: "Asia/Dhaka" })
    timezone!: string;

    @ApiProperty({ type: () => CurrencyInfoResponse })
    currency!: CurrencyInfoResponse;

    @ApiProperty({ type: () => MoneyResponse })
    minOrderValue!: MoneyResponse;

    @ApiProperty({ type: () => MoneyResponse })
    deliveryFee!: MoneyResponse;

    @ApiProperty({ type: () => MoneyResponse, nullable: true })
    freeDeliveryAbove!: MoneyResponse | null;

    @ApiProperty({ type: () => MoneyResponse })
    handlingFee!: MoneyResponse;

    @ApiProperty({ type: () => MoneyResponse, nullable: true })
    smallCartLimit!: MoneyResponse | null;

    @ApiProperty({ type: () => MoneyResponse, nullable: true })
    smallCartFee!: MoneyResponse | null;

    @ApiProperty({
        type: () => [SurchargeResponse],
        description: "Only surcharges live right now (manual switch on, or inside their schedule window)",
    })
    surcharges!: SurchargeResponse[];
}

export class RegionResponse {
    @ApiProperty({ example: "C" })
    code!: string;

    @ApiProperty({ example: "Dhaka" })
    name!: string;

    @ApiPropertyOptional({
        type: () => [RegionResponse],
        description: "Level-2 regions. When present, one of them must be sent as `districtCode`.",
    })
    children?: RegionResponse[];
}

export class PostcodeRuleResponse {
    @ApiProperty({ example: "Postcode" })
    label!: string;

    @ApiProperty({ example: "^\\d{4}$", description: "Regex source; test on the client for instant feedback" })
    pattern!: string;

    @ApiProperty({ example: "1212" })
    example!: string;

    @ApiProperty({ example: true })
    required!: boolean;
}

export class AddressCountryResponse {
    @ApiProperty({ example: "BD" })
    code!: string;

    @ApiProperty({ example: "Bangladesh", description: "Localized to Accept-Language" })
    name!: string;

    @ApiProperty({ example: "+880" })
    dialCode!: string;

    @ApiProperty({ type: [String], example: ["Division", "District"], description: "Labels for the cascading region dropdowns" })
    levels!: string[];

    @ApiProperty({ example: "City / Upazila / Thana" })
    cityLabel!: string;

    @ApiProperty({ type: () => PostcodeRuleResponse })
    postcode!: PostcodeRuleResponse;

    @ApiProperty({ type: [String], example: ["Asia/Dhaka"], description: "The timezone dropdown" })
    timezones!: string[];

    @ApiProperty({ example: "Asia/Dhaka" })
    defaultTimezone!: string;

    @ApiProperty({ type: () => [RegionResponse] })
    regions!: RegionResponse[];
}

export class StoreEnumsResponse {
    @ApiProperty({ enum: StoreStatus, isArray: true, example: Object.values(StoreStatus) })
    status!: StoreStatus[];

    @ApiProperty({ enum: StoreServiceMode, isArray: true, example: Object.values(StoreServiceMode) })
    serviceMode!: StoreServiceMode[];

    @ApiProperty({ type: [String], example: CHARGE_KINDS })
    chargeKind!: string[];

    @ApiProperty({ type: [String], example: CHARGE_CALCS })
    chargeCalc!: string[];

    @ApiProperty({ type: [String], example: CHARGE_TRIGGERS })
    chargeTrigger!: string[];
}

export class StoreLimitsResponse {
    @ApiProperty({ example: STORE_LIMITS.serviceRadiusM })
    serviceRadiusM!: { min: number; max: number };

    @ApiProperty({ example: STORE_LIMITS.maxAreas })
    maxAreas!: number;

    @ApiProperty({ example: STORE_LIMITS.maxPolygonPoints })
    maxPolygonPoints!: number;

    @ApiProperty({ example: STORE_LIMITS.minAreaM2 })
    minAreaM2!: number;

    @ApiProperty({ example: STORE_LIMITS.maxAreaDistanceM })
    maxAreaDistanceM!: number;

    @ApiProperty({ example: STORE_LIMITS.maxCharges })
    maxCharges!: number;

    @ApiProperty({ example: STORE_LIMITS.maxPrepMinutes })
    maxPrepMinutes!: number;
}

/** GET /admin/stores/meta */
export class StoreMetaResponse {
    @ApiProperty({ example: "en" })
    defaultLanguage!: string;

    @ApiProperty({ type: [String], example: ["en", "bn"] })
    languages!: string[];

    @ApiProperty({ example: "DS" })
    codePrefix!: string;

    @ApiProperty({ type: [String], example: ["BD", "IN"], description: "Countries allowed for the store phone" })
    phoneCountries!: string[];

    @ApiProperty({ type: () => [AddressCountryResponse] })
    countries!: AddressCountryResponse[];

    @ApiProperty({ type: () => StoreEnumsResponse })
    enums!: StoreEnumsResponse;

    @ApiProperty({ type: () => StoreLimitsResponse })
    limits!: StoreLimitsResponse;
}

/** GET /admin/stores/code-check */
export class StoreCodeCheckResponse {
    @ApiProperty({ type: String, nullable: true, example: "DS-DHK-GLS01", description: "The normalized code, or null when none was sent" })
    code!: string | null;

    @ApiProperty({ type: Boolean, nullable: true, example: true, description: "Format check; null when no code was sent" })
    valid!: boolean | null;

    @ApiProperty({ type: Boolean, nullable: true, example: false, description: "null when no valid code was sent" })
    available!: boolean | null;

    @ApiProperty({
        type: [String],
        example: ["DS-DHK-GLS02", "DS-DHK-GLS03", "DS-DHK-GLS04"],
        description: "Free codes; empty when the sent code is available",
    })
    suggestions!: string[];
}

/** GET /admin/stores/geocode */
export class GeocodedAddressResponse {
    @ApiProperty({ example: "House 12, Road 90, Gulshan 2, Dhaka 1212, Bangladesh" })
    formattedAddress!: string;

    @ApiProperty({ example: "ChIJ0wJ3x5bHVTcRQmA2zJr7r3U" })
    placeId!: string;

    @ApiProperty({ example: "BD" })
    countryCode!: string;

    @ApiProperty({ example: true, description: "false when the country is not in ADDRESS_COUNTRIES" })
    supported!: boolean;

    @ApiProperty({ type: String, nullable: true, example: "C" })
    stateCode!: string | null;

    @ApiProperty({ type: String, nullable: true, example: "Dhaka" })
    state!: string | null;

    @ApiProperty({ type: String, nullable: true, example: "13" })
    districtCode!: string | null;

    @ApiProperty({ type: String, nullable: true, example: "Dhaka" })
    district!: string | null;

    @ApiProperty({ type: String, nullable: true, example: "Dhaka" })
    city!: string | null;

    @ApiProperty({ type: String, nullable: true, example: "House 12, Road 90, Gulshan 2" })
    addressLine!: string | null;

    @ApiProperty({ type: String, nullable: true, example: "1212" })
    pincode!: string | null;

    @ApiProperty({ example: 23.7925 })
    latitude!: number;

    @ApiProperty({ example: 90.4078 })
    longitude!: number;
}

export class StoreAreaResponse {
    @ApiProperty({ ...BIGINT_ID, example: "31" })
    id!: string;

    @ApiProperty({ ...BIGINT_ID, example: "7" })
    storeId!: string;

    @ApiProperty({ example: "Gulshan 1 & 2" })
    name!: string;

    @ApiProperty({ type: String, nullable: true, example: null })
    placeId!: string | null;

    @ApiProperty({
        type: () => [LatLngDoc],
        example: [
            { lat: 23.78, lng: 90.4 },
            { lat: 23.78, lng: 90.42 },
            { lat: 23.8, lng: 90.42 },
            { lat: 23.8, lng: 90.4 },
        ],
    })
    polygon!: LatLngDoc[];

    @ApiProperty({ ...DECIMAL, example: "23.78" })
    minLat!: string;

    @ApiProperty({ ...DECIMAL, example: "23.8" })
    maxLat!: string;

    @ApiProperty({ ...DECIMAL, example: "90.4" })
    minLng!: string;

    @ApiProperty({ ...DECIMAL, example: "90.42" })
    maxLng!: string;

    @ApiProperty({ ...DECIMAL, nullable: true, example: null })
    deliveryFeeOverride!: string | null;

    @ApiProperty({ example: true })
    isActive!: boolean;

    @ApiProperty({ example: "2026-10-19T09:00:00.000Z" })
    createdAt!: string;
}

/** One element of the stored `charges` array. */
export class StoreChargeResponse {
    @ApiProperty({ example: "a1b2c3d4e5f6" })
    id!: string;

    @ApiProperty({ enum: CHARGE_KINDS, example: "RAIN_SURGE" })
    kind!: string;

    @ApiProperty({ ...LOCALE_MAP, nullable: true, example: { en: "Rain surge" } })
    label!: Record<string, string> | null;

    @ApiProperty({ enum: CHARGE_CALCS, example: "FLAT" })
    calc!: string;

    @ApiProperty({ example: 20 })
    amount!: number;

    @ApiProperty({ type: Number, nullable: true, example: null })
    maxAmount!: number | null;

    @ApiProperty({ enum: CHARGE_TRIGGERS, example: "MANUAL" })
    trigger!: string;

    @ApiProperty({ type: () => ChargeScheduleDoc, nullable: true, example: null })
    schedule!: ChargeScheduleDoc | null;

    @ApiProperty({ example: true })
    isActive!: boolean;
}

export class ReadinessCheckResponse {
    @ApiProperty({
        example: "phone",
        enum: ["address", "phone", "boundary", "openingHours", "logo", "staff", "catalog"],
    })
    key!: string;

    @ApiProperty({ example: true, description: "Blocking checks must pass before the store can become ACTIVE" })
    blocking!: boolean;

    @ApiProperty({ example: false })
    ok!: boolean;
}

export class StoreReadinessResponse {
    @ApiProperty({ example: false, description: "All blocking checks pass" })
    ready!: boolean;

    @ApiProperty({ type: () => [ReadinessCheckResponse] })
    checks!: ReadinessCheckResponse[];
}

/** Store columns shared by the list and the detail responses. */
export class StoreRecordResponse {
    @ApiProperty({ ...BIGINT_ID, example: "7" })
    id!: string;

    @ApiProperty({ example: "DS-DHK-GLS01" })
    code!: string;

    @ApiProperty({ ...LOCALE_MAP, example: { en: "Gulshan Hub Dark Store", bn: "গুলশান হাব ডার্ক স্টোর" } })
    name!: Record<string, string>;

    @ApiProperty({ example: "gulshan hub dark store | গুলশান হাব ডার্ক স্টোর", description: "Search/sort text" })
    nameSearch!: string;

    @ApiProperty({ type: String, nullable: true, example: "+8801712345678" })
    phone!: string | null;

    @ApiProperty({ type: String, nullable: true, example: "gulshan@example.com" })
    email!: string | null;

    @ApiProperty({ type: String, nullable: true, example: "TRAD/DNCC/012345/2026" })
    licenseNumber!: string | null;

    @ApiProperty({ ...BIGINT_ID, nullable: true, example: "88" })
    logoId!: string | null;

    @ApiProperty({ example: "BD" })
    countryCode!: string;

    @ApiProperty({ example: "C" })
    stateCode!: string;

    @ApiProperty({ example: "Dhaka" })
    state!: string;

    @ApiProperty({ type: String, nullable: true, example: "13" })
    districtCode!: string | null;

    @ApiProperty({ type: String, nullable: true, example: "Dhaka" })
    district!: string | null;

    @ApiProperty({ example: "Dhaka" })
    city!: string;

    @ApiProperty({ example: "House 12, Road 90, Gulshan 2" })
    addressLine!: string;

    @ApiProperty({ type: String, nullable: true, example: null })
    addressLine2!: string | null;

    @ApiProperty({ example: "1212" })
    pincode!: string;

    @ApiProperty({ ...DECIMAL, example: "23.7925" })
    latitude!: string;

    @ApiProperty({ ...DECIMAL, example: "90.4078" })
    longitude!: string;

    @ApiProperty({ type: String, nullable: true, example: null })
    placeId!: string | null;

    @ApiProperty({ enum: StoreServiceMode, example: StoreServiceMode.RADIUS })
    serviceMode!: StoreServiceMode;

    @ApiProperty({ type: Number, nullable: true, example: 3200 })
    serviceRadiusM!: number | null;

    @ApiProperty({ ...DECIMAL, example: "23.7637545" })
    bboxMinLat!: string;

    @ApiProperty({ ...DECIMAL, example: "23.8212455" })
    bboxMaxLat!: string;

    @ApiProperty({ ...DECIMAL, example: "90.3764" })
    bboxMinLng!: string;

    @ApiProperty({ ...DECIMAL, example: "90.4392" })
    bboxMaxLng!: string;

    @ApiProperty({ enum: StoreStatus, example: StoreStatus.ACTIVE })
    status!: StoreStatus;

    @ApiProperty({ example: true })
    isOpen!: boolean;

    @ApiProperty({ example: true, description: "The \"Order accept\" switch" })
    acceptingOrders!: boolean;

    @ApiProperty(OPENING_HOURS_SCHEMA)
    openingHours!: Record<string, string[][]> | null;

    @ApiProperty({ example: "Asia/Dhaka" })
    timezone!: string;

    @ApiProperty({ example: 8 })
    avgPrepMinutes!: number;

    @ApiProperty({ ...DECIMAL, example: "99" })
    minOrderValue!: string;

    @ApiProperty({ ...DECIMAL, example: "25" })
    deliveryFee!: string;

    @ApiProperty({ ...DECIMAL, nullable: true, example: "249" })
    freeDeliveryAbove!: string | null;

    @ApiProperty({ ...DECIMAL, example: "5" })
    handlingFee!: string;

    @ApiProperty({ ...DECIMAL, nullable: true, example: "149" })
    smallCartLimit!: string | null;

    @ApiProperty({ ...DECIMAL, nullable: true, example: "15" })
    smallCartFee!: string | null;

    @ApiProperty({ type: () => [StoreChargeResponse] })
    charges!: StoreChargeResponse[];

    @ApiProperty({ example: "2026-10-19T09:00:00.000Z" })
    createdAt!: string;

    @ApiProperty({ example: "2026-10-19T09:30:00.000Z" })
    updatedAt!: string;
}

export class StoreListCountResponse {
    @ApiProperty({ example: 2, description: "Active delivery polygons (0 in RADIUS mode)" })
    areas!: number;
}

export class StoreListItemResponse extends StoreRecordResponse {
    @ApiProperty({ type: () => StoreListCountResponse })
    _count!: StoreListCountResponse;
}

/** GET /admin/stores */
export class StoreListResponse {
    @ApiProperty({ type: () => [StoreListItemResponse] })
    items!: StoreListItemResponse[];

    @ApiProperty({ example: 3 })
    total!: number;

    @ApiProperty({ example: 1 })
    page!: number;

    @ApiProperty({ example: 20 })
    limit!: number;
}

export class StoreDetailCountResponse {
    @ApiProperty({ example: 4, description: "Assigned staff" })
    members!: number;

    @ApiProperty({ example: 1250, description: "Listed products" })
    storeProducts!: number;
}

/** GET /admin/stores/:id, POST, PATCH, GET/PATCH /store/profile */
export class StoreDetailResponse extends StoreRecordResponse {
    @ApiProperty({ type: () => [StoreAreaResponse], description: "Active delivery polygons (AREA mode)" })
    areas!: StoreAreaResponse[];

    @ApiProperty({ type: () => StoreDetailCountResponse })
    _count!: StoreDetailCountResponse;

    @ApiProperty({ type: () => StoreReadinessResponse })
    readiness!: StoreReadinessResponse;
}

// =====================================================================
// Controller-level decorators
// =====================================================================

const AUTH_ERRORS = (forbidden: string) =>
    applyDecorators(
        ApiBearerAuth(),
        ApiUnauthorizedResponse({
            description: "Missing, invalid or expired bearer token",
            schema: errorSchema(401, "Unauthorized", "Unauthorized"),
        }),
        ApiForbiddenResponse({
            description: forbidden,
            schema: errorSchema(403, "Forbidden", "Forbidden resource"),
        }),
    );

/** Storefront controller: public, no auth header. */
export function ApiStorefrontStoresController() {
    return applyDecorators(ApiTags("StorefrontStores"), ACCEPT_LANGUAGE_HEADER);
}

/** Admin controller: bearer auth + common 401 / 403 responses. */
export function ApiAdminStoresController() {
    return applyDecorators(
        ApiTags("AdminStores"),
        ApiExtraModels(MoneyResponse),
        ACCEPT_LANGUAGE_HEADER,
        AUTH_ERRORS("Role is not ADMIN / SUPER_ADMIN, or the required permission is missing"),
    );
}

/** Store manager controller: own store only. */
export function ApiStoreManagerController() {
    return applyDecorators(
        ApiTags("StoreManager"),
        ACCEPT_LANGUAGE_HEADER,
        AUTH_ERRORS("Role is not STORE_MANAGER, the permission is missing, or no store is assigned"),
    );
}

// =====================================================================
// Storefront endpoints
// =====================================================================

/** GET /app/stores/resolve */
export function ApiResolveStore() {
    return applyDecorators(
        ApiExtraModels(MoneyResponse),
        ApiOperation({
            summary: "Find the store that delivers to a location",
            description:
                "Public. Returns the nearest ACTIVE store whose radius or polygon covers the point. " +
                "Checked locally (no map API calls) and cached per ~11 m cell. " +
                "Name is localized; money fields are formatted; `surcharges` lists only charges live right now.",
        }),
        ApiQuery({ name: "lat", required: true, type: Number, example: 23.7925 }),
        ApiQuery({ name: "lng", required: true, type: Number, example: 90.4078 }),
        ApiOkResponse({
            description: "Serving store",
            type: StorefrontStoreResponse,
            example: {
                id: "7",
                code: "DS-DHK-GLS01",
                name: "Gulshan Hub Dark Store",
                latitude: "23.7925",
                longitude: "90.4078",
                isOpen: true,
                acceptingOrders: true,
                avgPrepMinutes: 8,
                openingHours: { mon: [["07:00", "23:00"]] },
                timezone: "Asia/Dhaka",
                currency: { code: "BDT", symbol: "৳" },
                minOrderValue: { amount: 99, currency: "BDT", symbol: "৳", formatted: "৳99.00" },
                deliveryFee: { amount: 25, currency: "BDT", symbol: "৳", formatted: "৳25.00" },
                freeDeliveryAbove: { amount: 249, currency: "BDT", symbol: "৳", formatted: "৳249.00" },
                handlingFee: { amount: 5, currency: "BDT", symbol: "৳", formatted: "৳5.00" },
                smallCartLimit: null,
                smallCartFee: null,
                surcharges: [
                    {
                        id: "a1b2c3d4e5f6",
                        kind: "RAIN_SURGE",
                        label: "Rain surge",
                        calc: "FLAT",
                        amount: { amount: 20, currency: "BDT", symbol: "৳", formatted: "৳20.00" },
                        maxAmount: null,
                    },
                ],
            },
        }),
        ApiBadRequestResponse({
            description: "`lat` / `lng` missing or out of range",
            schema: errorSchema(400, "Bad Request", ["lat must be a valid latitude"]),
        }),
        ApiNotFoundResponse({
            description: "No active store covers this location (`stores.errors.notServiceable`, code NOT_SERVICEABLE)",
            schema: errorSchema(404, "Not Found", "We do not deliver here yet"),
        }),
    );
}

// =====================================================================
// Admin endpoints
// =====================================================================

/** GET /admin/stores/meta */
export function ApiStoreMeta() {
    return applyDecorators(
        ApiOperation({
            summary: "Get everything the Add / Edit Store form needs",
            description:
                "Requires `STORE_READ`. Countries from ADDRESS_COUNTRIES with their cascading regions " +
                "(country → state/division → district), postcode rule and timezone dropdown; phone countries; " +
                "languages; enums and limits. Load once — the form needs no other lookups and no Places API calls. " +
                "Sent with `Cache-Control: private, max-age=3600`.",
        }),
        ApiOkResponse({
            description: "Form metadata",
            type: StoreMetaResponse,
            example: {
                defaultLanguage: "en",
                languages: ["en", "bn"],
                codePrefix: "DS",
                phoneCountries: ["BD", "IN"],
                countries: [
                    {
                        code: "BD",
                        name: "Bangladesh",
                        dialCode: "+880",
                        levels: ["Division", "District"],
                        cityLabel: "City / Upazila / Thana",
                        postcode: { label: "Postcode", pattern: "^\\d{4}$", example: "1212", required: true },
                        timezones: ["Asia/Dhaka"],
                        defaultTimezone: "Asia/Dhaka",
                        regions: [
                            {
                                code: "C",
                                name: "Dhaka",
                                children: [
                                    { code: "13", name: "Dhaka" },
                                    { code: "18", name: "Gazipur" },
                                ],
                            },
                        ],
                    },
                    {
                        code: "IN",
                        name: "India",
                        dialCode: "+91",
                        levels: ["State / UT"],
                        cityLabel: "City",
                        postcode: { label: "PIN code", pattern: "^[1-9]\\d{5}$", example: "560034", required: true },
                        timezones: ["Asia/Kolkata"],
                        defaultTimezone: "Asia/Kolkata",
                        regions: [{ code: "KA", name: "Karnataka" }],
                    },
                ],
                enums: {
                    status: ["ACTIVE", "INACTIVE", "SUSPENDED", "DRAFT"],
                    serviceMode: ["RADIUS", "AREA"],
                    chargeKind: CHARGE_KINDS,
                    chargeCalc: CHARGE_CALCS,
                    chargeTrigger: CHARGE_TRIGGERS,
                },
                limits: STORE_LIMITS,
            },
        }),
    );
}

/** GET /admin/stores/code-check */
export function ApiCheckStoreCode() {
    return applyDecorators(
        ApiOperation({
            summary: "Check a store code and get suggestions",
            description:
                "Requires `STORE_READ`. Send `code` to check it, and/or `city` + `name` to get suggestions in the " +
                "`DS-<CITY>-<AREA><NN>` pattern. When the code is taken, suggests the next free numbers. " +
                "Suggestions are not reserved; uniqueness is enforced again on create (409).",
        }),
        ApiQuery({ name: "code", required: false, type: String, example: "DS-DHK-GLS01" }),
        ApiQuery({ name: "city", required: false, type: String, example: "Dhaka" }),
        ApiQuery({ name: "name", required: false, type: String, example: "Gulshan Hub Dark Store", description: "Default-language name" }),
        ApiOkResponse({
            description: "Availability and suggestions",
            type: StoreCodeCheckResponse,
            examples: {
                available: {
                    summary: "Code is free",
                    value: { code: "DS-DHK-GLS01", valid: true, available: true, suggestions: [] },
                },
                taken: {
                    summary: "Code is taken",
                    value: { code: "DS-DHK-GLS01", valid: true, available: false, suggestions: ["DS-DHK-GLS02", "DS-DHK-GLS03", "DS-DHK-GLS04"] },
                },
                suggestOnly: {
                    summary: "Suggestions from city + name",
                    value: { code: null, valid: null, available: null, suggestions: ["DS-DHK-GLS01", "DS-DHK-GLS02", "DS-DHK-GLS03"] },
                },
            },
        }),
    );
}

/** GET /admin/stores/geocode */
export function ApiGeocodeStorePin() {
    return applyDecorators(
        ApiOperation({
            summary: "Turn a map pin into address fields",
            description:
                "Requires `STORE_READ`. Reverse-geocodes with Google and maps the result to this API's codes " +
                "(`stateCode`, `districtCode`) for prefilling the form. Cached per ~11 m cell and language for " +
                "GEOCODE_CACHE_TTL_SEC, so repeated pin drops cost one Google call. Returns `null` when Google has no address.",
        }),
        ApiQuery({ name: "lat", required: true, type: Number, example: 23.7925 }),
        ApiQuery({ name: "lng", required: true, type: Number, example: 90.4078 }),
        ApiOkResponse({ description: "Address prefill, or null", type: GeocodedAddressResponse }),
        ApiResponse({
            status: 502,
            description: "Google request failed or returned an error status (`address.errors.geocodeFailed`)",
            schema: errorSchema(502, "Bad Gateway", "Address lookup failed. Please try again."),
        }),
        ApiResponse({
            status: 503,
            description: "GOOGLE_MAPS_SERVER_KEY is not configured (`address.errors.geocodeUnavailable`)",
            schema: errorSchema(503, "Service Unavailable", "Address lookup is not configured."),
        }),
    );
}

/** GET /admin/stores */
export function ApiAdminStoreList() {
    return applyDecorators(
        ApiOperation({
            summary: "List stores (paginated)",
            description:
                "Requires `STORE_READ`. For the stores table. Search matches the name in every language, code, phone and city. " +
                "`_count.areas` gives the polygon count for AREA mode.",
        }),
        ApiQuery({ name: "page", required: false, type: Number, example: 1, description: "Page number (1-based)" }),
        ApiQuery({ name: "limit", required: false, type: Number, example: 20, description: "Items per page (max 100)" }),
        ApiQuery({ name: "q", required: false, type: String, example: "gulshan", description: "Search term (max 100 chars)" }),
        ApiQuery({ name: "status", required: false, enum: StoreStatus }),
        ApiQuery({ name: "serviceMode", required: false, enum: StoreServiceMode }),
        ApiQuery({ name: "countryCode", required: false, type: String, example: "BD" }),
        ApiQuery({
            name: "sort",
            required: false,
            enum: ["newest", "oldest", "name_asc", "name_desc", "updated_asc", "updated_desc"],
            description: "Default: newest",
        }),
        ApiOkResponse({ description: "One page of stores", type: StoreListResponse }),
        ApiBadRequestResponse({
            description: "Invalid query (unknown status / sort, bad countryCode …)",
            schema: errorSchema(400, "Bad Request", ["status has an invalid value"]),
        }),
    );
}

/** GET /admin/stores/:id */
export function ApiAdminStoreGet() {
    return applyDecorators(
        ApiOperation({
            summary: "Get a store for the edit form",
            description:
                "Requires `STORE_READ`. All columns, active polygons, staff/product counts and the readiness checklist.",
        }),
        ID_PARAM,
        ApiOkResponse({ description: "Store details", type: StoreDetailResponse }),
        NOT_FOUND,
    );
}

const ADDRESS_ERRORS = [
    "Country not in ADDRESS_COUNTRIES (`address.errors.unsupportedCountry`)",
    "Unknown state / division (`address.errors.invalidRegion`)",
    "District missing or not in the chosen division (`address.errors.regionRequired` / `invalidSubRegion`)",
    "Postcode missing or not matching the country's pattern (`address.errors.postcodeRequired` / `invalidPostcode`)",
    "Timezone not one of the country's timezones (`address.errors.timezoneNotAllowed`)",
];

const BOUNDARY_ERRORS = [
    "RADIUS mode without `serviceRadiusM` (`stores.errors.serviceRadiusRequired`)",
    "AREA mode without polygons (`stores.errors.areaRequired`) or too many (`tooManyAreas`)",
    "Polygon with < 3 distinct points, too many points, crossing edges, too small or too far from the pin " +
        "(`polygonTooFewPoints` / `polygonTooManyPoints` / `polygonSelfIntersecting` / `polygonTooSmall` / `polygonTooFar`)",
];

const COMMERCIAL_ERRORS = [
    "`smallCartFee` without `smallCartLimit` (`stores.errors.smallCartLimitRequired`)",
    "Duplicate charge kind, CUSTOM without label, percent > 100, SCHEDULE without a window " +
        "(`chargeDuplicateKind` / `chargeLabelRequired` / `chargePercentTooHigh` / `chargeScheduleRequired`)",
    "Invalid `openingHours` (`stores.errors.openingHoursInvalid`)",
    "Phone not E.164 or not from PHONE_ALLOWED_COUNTRIES (`validation.errors.invalidPhone`)",
];

const READINESS_ERROR =
    "Setting ACTIVE while a blocking readiness check fails — address, phone or boundary (`stores.errors.notReady`)";

/** POST /admin/stores */
export function ApiCreateStore() {
    return applyDecorators(
        ApiOperation({
            summary: "Create a store",
            description:
                "Requires `STORE_CREATE`. Validates the address for the country (regions, postcode, timezone), " +
                "the delivery boundary and the cart rules. Starts as DRAFT unless `status` is sent; ACTIVE needs the " +
                "blocking readiness checks to pass. Returns the full store with its readiness checklist.",
        }),
        ApiBody({
            type: StoreCreateBodyDoc,
            examples: {
                radius: {
                    summary: "Radius mode (Bangladesh)",
                    value: {
                        code: "DS-DHK-GLS01",
                        name: { en: "Gulshan Hub Dark Store", bn: "গুলশান হাব ডার্ক স্টোর" },
                        phone: "+8801712345678",
                        email: "gulshan@example.com",
                        licenseNumber: "TRAD/DNCC/012345/2026",
                        countryCode: "BD",
                        stateCode: "C",
                        districtCode: "13",
                        city: "Dhaka",
                        addressLine: "House 12, Road 90, Gulshan 2",
                        pincode: "1212",
                        latitude: 23.7925,
                        longitude: 90.4078,
                        timezone: "Asia/Dhaka",
                        serviceMode: "RADIUS",
                        serviceRadiusM: 3200,
                        avgPrepMinutes: 8,
                        minOrderValue: 99,
                        deliveryFee: 25,
                        freeDeliveryAbove: 249,
                        handlingFee: 5,
                        smallCartLimit: 149,
                        smallCartFee: 15,
                        openingHours: { mon: [["07:00", "23:00"]], fri: [["15:00", "23:00"]] },
                        charges: [
                            { kind: "RAIN_SURGE", calc: "FLAT", amount: 20, trigger: "MANUAL", isActive: false },
                            {
                                kind: "NIGHT_SURGE",
                                calc: "PERCENT",
                                amount: 10,
                                maxAmount: 40,
                                trigger: "SCHEDULE",
                                schedule: { from: "22:00", to: "06:00" },
                            },
                        ],
                    },
                },
                polygons: {
                    summary: "Polygon mode (India, state only)",
                    value: {
                        code: "DS-BNG-IND02",
                        name: { en: "Indiranagar 100ft Pod" },
                        phone: "+919876543210",
                        countryCode: "IN",
                        stateCode: "KA",
                        city: "Bengaluru",
                        addressLine: "12/A, Defence Colony, 100 Feet Rd, Indiranagar",
                        pincode: "560038",
                        latitude: 12.9719,
                        longitude: 77.6412,
                        serviceMode: "AREA",
                        areas: [
                            {
                                name: "Indiranagar",
                                polygon: [
                                    { lat: 12.96, lng: 77.63 },
                                    { lat: 12.96, lng: 77.65 },
                                    { lat: 12.985, lng: 77.65 },
                                    { lat: 12.985, lng: 77.63 },
                                ],
                            },
                        ],
                        deliveryFee: 29,
                        freeDeliveryAbove: 299,
                    },
                },
            },
        }),
        ApiCreatedResponse({ description: "Created store", type: StoreDetailResponse }),
        ApiBadRequestResponse({
            description: causes("Invalid payload", [
                "Body validation failed (missing required field, bad format, unknown enum …)",
                "Code format invalid (`stores.errors.codeInvalid`)",
                ...ADDRESS_ERRORS,
                ...BOUNDARY_ERRORS,
                ...COMMERCIAL_ERRORS,
                READINESS_ERROR,
            ]),
            schema: errorSchema(400, "Bad Request", "Select a valid District in Dhaka."),
        }),
        ApiConflictResponse({
            description: "Store code already used (`stores.errors.codeTaken`, code CODE_TAKEN)",
            schema: errorSchema(409, "Conflict", "Store code DS-DHK-GLS01 is already in use."),
        }),
    );
}

/** PATCH /admin/stores/:id */
export function ApiUpdateStore() {
    return applyDecorators(
        ApiOperation({
            summary: "Update a store (partial)",
            description:
                "Requires `STORE_UPDATE`. One endpoint for every edit — identity, address, boundary, cart rules, " +
                "surcharges, status and the open / order-accept switches. Send only what changes. Changing any " +
                "address part re-validates the whole address; switching country resets an invalid timezone to the " +
                "country default. `areas` / `charges` replace the stored lists. The location cache is cleared only " +
                "when the boundary or status changes.",
        }),
        ID_PARAM,
        ApiBody({
            type: StoreUpdateBodyDoc,
            examples: {
                toggleOrders: { summary: "Stop accepting orders", value: { acceptingOrders: false } },
                activate: { summary: "Activate (readiness must pass)", value: { status: "ACTIVE" } },
                rainOn: {
                    summary: "Switch rain surge on (send the full charges list)",
                    value: {
                        charges: [
                            { id: "a1b2c3d4e5f6", kind: "RAIN_SURGE", calc: "FLAT", amount: 20, trigger: "MANUAL", isActive: true },
                        ],
                    },
                },
                moveDistrict: {
                    summary: "Change district",
                    value: { stateCode: "C", districtCode: "18", city: "Gazipur", pincode: "1700" },
                },
                radius: { summary: "Change delivery radius", value: { serviceMode: "RADIUS", serviceRadiusM: 4000 } },
            },
        }),
        ApiOkResponse({ description: "Updated store", type: StoreDetailResponse }),
        ApiBadRequestResponse({
            description: causes("Invalid payload", [
                "Body validation failed",
                ...ADDRESS_ERRORS,
                ...BOUNDARY_ERRORS,
                ...COMMERCIAL_ERRORS,
                READINESS_ERROR,
            ]),
            schema: errorSchema(400, "Bad Request", "The store can't be activated yet. Missing: phone."),
        }),
        NOT_FOUND,
    );
}

export class StoreDeleteResponse {
    @ApiProperty({ example: true })
    success!: boolean;

    @ApiProperty({ ...BIGINT_ID, example: "7" })
    id!: string;

    @ApiProperty({ example: "DS-DHK-GLS01" })
    code!: string;

    @ApiProperty({ example: 2, description: "Staff whose store assignment was cleared" })
    detachedMembers!: number;
}

/** DELETE /admin/stores/:id */
export function ApiDeleteStore() {
    return applyDecorators(
        ApiOperation({
            summary: "Delete a store permanently",
            description:
                "Requires `STORE_DELETE`. Only for stores that never traded: the store must not be ACTIVE and must have " +
                "no orders. Delivery areas, store products and bundles are deleted with it; carts and staff are detached " +
                "(staff keep their accounts, without a store). For stores with history, set `status: INACTIVE` instead.",
        }),
        ID_PARAM,
        ApiOkResponse({ description: "Store deleted", type: StoreDeleteResponse }),
        NOT_FOUND,
        ApiConflictResponse({
            description: causes("Store cannot be deleted", [
                "Store is ACTIVE — deactivate it first (`stores.errors.deleteActive`, code STORE_ACTIVE)",
                "Store has orders (`stores.errors.deleteHasOrders`, code STORE_HAS_ORDERS)",
                "Other records still reference the store, e.g. stock history (`stores.errors.deleteInUse`, code STORE_IN_USE)",
            ]),
            schema: errorSchema(409, "Conflict", "Deactivate the store before deleting it."),
        }),
    );
}

// =====================================================================
// Store manager endpoints
// =====================================================================

/** GET /store/profile */
export function ApiMyStoreGet() {
    return applyDecorators(
        ApiOperation({
            summary: "Get my store",
            description: "Requires `STORE_READ`. The store assigned to the signed-in store manager, with readiness.",
        }),
        ApiOkResponse({ description: "Store details", type: StoreDetailResponse }),
        NOT_FOUND,
    );
}

/** PATCH /store/profile */
export function ApiMyStoreUpdate() {
    return applyDecorators(
        ApiOperation({
            summary: "Update my store's operations",
            description:
                "Requires `STORE_UPDATE`. Operational fields only: open / order-accept switches, opening hours, " +
                "prep time, cart rules and phone. Surcharges have their own endpoints (`/store/profile/charges`). " +
                "Location, boundary and status stay with admins. " +
                "Other fields are rejected by the whitelist.",
        }),
        ApiBody({
            type: StoreOperationalBodyDoc,
            examples: {
                pause: { summary: "Pause orders", value: { acceptingOrders: false } },
                hours: { summary: "Change opening hours", value: { openingHours: { mon: [["08:00", "22:00"]] } } },
                fees: { summary: "Change fees", value: { deliveryFee: 30, freeDeliveryAbove: 349 } },
            },
        }),
        ApiOkResponse({ description: "Updated store", type: StoreDetailResponse }),
        ApiBadRequestResponse({
            description: causes("Invalid payload", COMMERCIAL_ERRORS.filter((e) => !e.includes("charge kind"))),
            schema: errorSchema(400, "Bad Request", "Set a small cart limit when charging a small cart fee."),
        }),
        NOT_FOUND,
    );
}

// =====================================================================
// Surcharges & live status (store manager + admin)
// =====================================================================

export class StoreChargesBodyDoc {
    @ApiProperty({ type: () => [StoreChargeBodyDoc], maxItems: STORE_LIMITS.maxCharges, description: "Full list; replaces the stored one" })
    charges!: StoreChargeBodyDoc[];
}

export class ToggleChargeBodyDoc {
    @ApiProperty({ example: true })
    isActive!: boolean;
}

export class LiveChargeResponse extends StoreChargeResponse {
    @ApiProperty({ example: true, description: "Applies to carts right now (MANUAL switch on, or inside the SCHEDULE window)" })
    isLive!: boolean;
}

export class StoreChargesResponse {
    @ApiProperty({ example: "Asia/Dhaka" })
    timezone!: string;

    @ApiProperty({ type: () => [LiveChargeResponse] })
    charges!: LiveChargeResponse[];
}

export class StoreOperatingStatusResponse {
    @ApiProperty({ enum: StoreStatus, example: "ACTIVE" })
    status!: string;

    @ApiProperty({ example: true, description: "Manual open / closed switch" })
    isOpen!: boolean;

    @ApiProperty({ example: true, description: "Order-accept switch" })
    acceptingOrders!: boolean;

    @ApiProperty({ example: true, description: "Inside `openingHours` now (true when no hours are set)" })
    withinOpeningHours!: boolean;

    @ApiProperty({ example: true, description: "ACTIVE && isOpen && acceptingOrders && withinOpeningHours — checkout is allowed" })
    canTakeOrders!: boolean;

    @ApiProperty({ example: "Asia/Dhaka" })
    timezone!: string;

    @ApiProperty({ example: "Tue 21:40", description: "Store-local weekday and time" })
    localTime!: string;

    @ApiProperty(OPENING_HOURS_SCHEMA)
    openingHours!: Record<string, [string, string][]> | null;

    @ApiProperty({ example: 8 })
    avgPrepMinutes!: number;

    @ApiProperty({ type: () => [StoreChargeResponse] })
    liveCharges!: StoreChargeResponse[];
}

const CHARGE_ID_PARAM = ApiParam({ name: "chargeId", description: "Charge id from the charges list", example: "a1b2c3d4e5f6" });

const CHARGES_EXAMPLE = {
    timezone: "Asia/Dhaka",
    charges: [
        { id: "a1b2c3d4e5f6", kind: "RAIN_SURGE", label: null, calc: "FLAT", amount: 20, maxAmount: null, trigger: "MANUAL", schedule: null, isActive: true, isLive: true },
        { id: "b7c8d9e0f1a2", kind: "NIGHT_SURGE", label: null, calc: "FLAT", amount: 15, maxAmount: null, trigger: "SCHEDULE", schedule: { days: [], from: "23:00", to: "06:00" }, isActive: true, isLive: false },
        { id: "c3d4e5f6a7b8", kind: "PEAK_SURGE", label: null, calc: "PERCENT", amount: 5, maxAmount: 30, trigger: "SCHEDULE", schedule: { days: [5, 6], from: "18:00", to: "21:00" }, isActive: true, isLive: false },
    ],
};

/** GET /store/profile/status */
export function ApiMyStoreStatus() {
    return applyDecorators(
        ApiOperation({
            summary: "Is my store taking orders right now?",
            description:
                "Requires `store.read`. Combines the manual switches, opening hours (store timezone) and store status. " +
                "Checkout is rejected (`orders.errors.storeClosed`) whenever `canTakeOrders` is false.",
        }),
        ApiOkResponse({
            description: "Live status",
            type: StoreOperatingStatusResponse,
            example: {
                status: "ACTIVE", isOpen: true, acceptingOrders: true, withinOpeningHours: true, canTakeOrders: true,
                timezone: "Asia/Dhaka", localTime: "Tue 21:40", openingHours: { mon: [["07:00", "02:00"]], tue: [["07:00", "02:00"]] },
                avgPrepMinutes: 8, liveCharges: [CHARGES_EXAMPLE.charges[0]],
            },
        }),
        NOT_FOUND,
    );
}

/** GET /store/profile/charges and GET /admin/stores/:id/charges */
export function ApiStoreCharges() {
    return applyDecorators(
        ApiOperation({
            summary: "List surcharges (rain / night / peak surge, packaging, custom)",
            description: "Requires `store.read`. `isLive` tells whether each charge is added to carts right now.",
        }),
        ApiOkResponse({ description: "Charges", type: StoreChargesResponse, example: CHARGES_EXAMPLE }),
        NOT_FOUND,
    );
}

/** PUT /store/profile/charges */
export function ApiReplaceStoreCharges() {
    return applyDecorators(
        ApiOperation({
            summary: "Replace surcharges",
            description:
                "Requires `store.update`. Sends the full list (echo `id` to keep a charge). One of each kind except CUSTOM (needs a label). " +
                "FLAT = money, PERCENT = % of cart subtotal (capped by `maxAmount`). MANUAL charges are on/off switches (default off); " +
                "SCHEDULE charges apply inside their window (store timezone, overnight allowed). Live charges are added to the cart's " +
                "handling fee and listed in `surcharges` of the cart.",
        }),
        ApiBody({
            type: StoreChargesBodyDoc,
            examples: {
                full: {
                    summary: "Rain switch + night & peak windows",
                    value: {
                        charges: [
                            { id: "a1b2c3d4e5f6", kind: "RAIN_SURGE", calc: "FLAT", amount: 20, trigger: "MANUAL", isActive: false },
                            { kind: "NIGHT_SURGE", calc: "FLAT", amount: 15, trigger: "SCHEDULE", schedule: { from: "23:00", to: "06:00" } },
                            { kind: "PEAK_SURGE", calc: "PERCENT", amount: 5, maxAmount: 30, trigger: "SCHEDULE", schedule: { days: [5, 6], from: "18:00", to: "21:00" } },
                            { kind: "CUSTOM", label: { en: "Festival fee" }, calc: "FLAT", amount: 10, trigger: "MANUAL", isActive: true },
                        ],
                    },
                },
                clear: { summary: "Remove all", value: { charges: [] } },
            },
        }),
        ApiOkResponse({ description: "Saved charges", type: StoreChargesResponse, example: CHARGES_EXAMPLE }),
        ApiBadRequestResponse({
            description: causes("Invalid charges", [COMMERCIAL_ERRORS[1]]),
            schema: errorSchema(400, "Bad Request", "Only one RAIN_SURGE charge is allowed per store."),
        }),
        NOT_FOUND,
    );
}

/** PATCH /store/profile/charges/:chargeId and PATCH /admin/stores/:id/charges/:chargeId */
export function ApiToggleStoreCharge() {
    return applyDecorators(
        ApiOperation({
            summary: "Switch one surcharge on / off",
            description: "Requires `store.update`. E.g. it started raining: switch RAIN_SURGE on. Other charges are untouched.",
        }),
        CHARGE_ID_PARAM,
        ApiBody({ type: ToggleChargeBodyDoc, examples: { on: { summary: "On", value: { isActive: true } }, off: { summary: "Off", value: { isActive: false } } } }),
        ApiOkResponse({ description: "Charges after the change", type: StoreChargesResponse, example: CHARGES_EXAMPLE }),
        ApiNotFoundResponse({
            description: "Store or charge not found (`stores.errors.notFound` / `stores.errors.chargeNotFound`)",
            schema: errorSchema(404, "Not Found", "Charge not found on this store."),
        }),
    );
}

/** Admin variants need the `:id` param. */
export const ApiAdminStoreIdParam = () => ID_PARAM;
