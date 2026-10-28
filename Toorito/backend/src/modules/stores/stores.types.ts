import type { LocaleMap } from "@core/locale/locale.service";
import {
    ChargeCalc,
    ChargeKind,
    ChargeTrigger,
    OpeningHours,
} from "./stores.util";
import { StoreServiceMode, StoreStatus } from "@prisma-client/enums";

/** Plain input types of the stores services (no decorators; the HTTP DTOs in src/api implement them). */


export interface LatLngInput {
    lat: number;
    lng: number;
}

export interface StoreAreaInput {
    /**
     * Ignored: areas are replaced as a whole on save. Accepted so the admin
     * UI can send back the areas it received from GET unchanged.
     */
    id?: string;
    name: string;
    /** Google Maps Place ID, if the area was picked from a place. */
    placeId?: string;
    polygon: LatLngInput[];
    deliveryFeeOverride?: number;
}

export interface OperationalInput {
    /** Manual open/closed override. */
    isOpen?: boolean;
    /** "Order accept" switch. */
    acceptingOrders?: boolean;
    openingHours?: OpeningHours | null;
    avgPrepMinutes?: number;
    minOrderValue?: number;
    /** Base delivery fee. */
    deliveryFee?: number;
    /** null = delivery is never free. */
    freeDeliveryAbove?: number | null;
    handlingFee?: number;
    /** Carts below this subtotal pay `smallCartFee`. */
    smallCartLimit?: number | null;
    smallCartFee?: number | null;
    /** E.164, limited to PHONE_ALLOWED_COUNTRIES. */
    phone?: string | null;
}

export interface ChargeScheduleInput {
    /** 0 = Sunday … 6 = Saturday; omit for every day. */
    days?: number[];
    from: string;
    to: string;
}

/** Rain / night / peak surge, packaging, or a custom charge. */
export interface StoreChargeInput {
    /** Echo the id of an existing charge to keep it stable; omit for a new one. */
    id?: string;
    kind: ChargeKind;
    /** Required for CUSTOM; optional (and `{}` allowed) for the other kinds. */
    label?: LocaleMap;
    calc: ChargeCalc;
    /** FLAT: money. PERCENT: 0–100 of cart subtotal. */
    amount: number;
    /** PERCENT only: cap in money. */
    maxAmount?: number;
    trigger: ChargeTrigger;
    schedule?: ChargeScheduleInput;
    /** MANUAL: on/off switch (default off). SCHEDULE: enabled (default on). */
    isActive?: boolean;
}

export interface CreateStoreInput extends OperationalInput {
    code: string;
    name: LocaleMap;
    email?: string | null;
    licenseNumber?: string | null;
    logoId?: number | null;
    /** One of the country's timezones (GET admin/stores/meta). Defaults to the first. */
    timezone?: string;
    /** Defaults to DRAFT. ACTIVE only when the readiness checks pass. */
    status?: StoreStatus;
    countryCode: string;
    /** Level-1 region code from meta, e.g. "C" (Dhaka division) or "KA" (Karnataka). */
    stateCode: string;
    /** Level-2 region code; required when the chosen level-1 region has children. */
    districtCode?: string | null;
    city: string;
    addressLine: string;
    addressLine2?: string | null;
    /** Validated against the country's postcode rule. */
    pincode?: string;
    latitude: number;
    longitude: number;
    placeId?: string | null;
    serviceMode: StoreServiceMode;
    /** RADIUS mode: metres around the pin. */
    serviceRadiusM?: number;
    /** AREA mode: one or more polygons. Sending this replaces all areas. */
    areas?: StoreAreaInput[];
    /** Full list; replaces Store.charges. Omit to leave charges unchanged. */
    charges?: StoreChargeInput[];
}

/** Everything optional; `code` is immutable after creation. */
export interface UpdateStoreInput extends Partial<Omit<CreateStoreInput, "code">> {
}

export interface CodeCheckQueryInput {
    /** Code to check. Omit to only get suggestions. */
    code?: string;
    /** For suggestions, e.g. "Dhaka". */
    city?: string;
    /** Store name in the default language, e.g. "Gulshan Hub Dark Store". */
    name?: string;
}
