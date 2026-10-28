import { AppConfig } from "@config/config.type";
import { ADDRESS_FORMATS, AddressFormat, RegionDef } from "@core/address/address.data";
import { RedisService } from "@core/redis/redis.service";
import {
    BadGatewayException,
    BadRequestException,
    Global,
    Injectable,
    Module,
    ServiceUnavailableException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { CountryCode, getCountryCallingCode } from "libphonenumber-js";
import { I18nService } from "nestjs-i18n";

/** Address parts as sent by a form (codes or names are both accepted). */
export interface AddressInput {
    countryCode: string;
    stateCode: string;
    districtCode?: string | null;
    pincode?: string | null;
}

/** Canonical address parts, ready to store. */
export interface NormalizedAddress {
    countryCode: string;
    stateCode: string;
    state: string;
    districtCode: string | null;
    district: string | null;
    pincode: string;
}

/** Pin → address prefill. Codes are null when they could not be matched. */
export interface GeocodedAddress {
    formattedAddress: string;
    placeId: string;
    countryCode: string;
    /** false when the country is not in ADDRESS_COUNTRIES. */
    supported: boolean;
    stateCode: string | null;
    state: string | null;
    districtCode: string | null;
    district: string | null;
    city: string | null;
    addressLine: string | null;
    pincode: string | null;
    latitude: number;
    longitude: number;
}

interface Problem {
    key: string;
    args?: Record<string, unknown>;
}

interface GoogleGeocodeResponse {
    status: string;
    results: {
        formatted_address: string;
        place_id: string;
        address_components: { long_name: string; short_name: string; types: string[] }[];
    }[];
}

/** Case/accent-insensitive key; ignores words like "Division" or "District". */
const normalizeName = (value: string) =>
    value
        .toLowerCase()
        .normalize("NFKD")
        .replace(/[̀-ͯ]/g, "")
        .replace(/\b(division|district|zila|zilla|state|province|union territory)\b/g, "")
        .replace(/[^a-z0-9]/g, "");

/** Finds a region by code, name or alias. */
export function findRegion(
    regions: RegionDef[] | undefined,
    input: string | null | undefined,
): RegionDef | undefined {
    if (!regions?.length || !input?.trim()) {
        return undefined;
    }

    const wanted = normalizeName(input);

    return regions.find(
        (region) =>
            normalizeName(region.code) === wanted ||
            normalizeName(region.name) === wanted ||
            region.aliases?.some((alias) => normalizeName(alias) === wanted),
    );
}

/** Region tree for clients, without the matching aliases. */
const publicRegions = (regions: RegionDef[]): Omit<RegionDef, "aliases">[] =>
    regions.map(({ code, name, children }) =>
        children?.length ? { code, name, children: publicRegions(children) } : { code, name },
    );

/**
 * Country-aware addresses: which countries are allowed (`ADDRESS_COUNTRIES`),
 * their region hierarchy, postcode rules and timezones, plus a cached
 * reverse geocoder so repeated pin drops cost one Google call.
 */
@Injectable()
export class AddressService {
    readonly countries: string[];

    private readonly allowed: ReadonlySet<string>;
    private readonly geocodeKey: string;
    private readonly geocodeTtlSec: number;

    constructor(
        config: ConfigService,
        private readonly redis: RedisService,
        private readonly i18n: I18nService,
    ) {
        const address = config.getOrThrow<AppConfig["address"]>("address");
        const missing = address.countries.filter((country) => !ADDRESS_FORMATS[country]);

        if (!address.countries.length) {
            throw new Error("ADDRESS_COUNTRIES must list at least one country");
        }

        if (missing.length) {
            throw new Error(
                `ADDRESS_COUNTRIES: no address format for ${missing.join(", ")}. ` +
                    "Add it to src/core/address/address.data.ts",
            );
        }

        this.countries = address.countries;
        this.allowed = new Set(address.countries);
        this.geocodeKey = address.googleMapsServerKey;
        this.geocodeTtlSec = address.geocodeCacheTtlSec;
    }

    /** The format of an allowed country, or undefined. */
    format(countryCode: string | null | undefined): AddressFormat | undefined {
        const code = countryCode?.trim().toUpperCase();
        return code && this.allowed.has(code) ? ADDRESS_FORMATS[code] : undefined;
    }

    /** Everything an address form needs: countries → cascading regions, rules, timezones. */
    catalog(language = "en") {
        let names: Intl.DisplayNames | undefined;

        try {
            names = new Intl.DisplayNames([language, "en"], { type: "region" });
        } catch {
            names = undefined;
        }

        return this.countries.map((code) => {
            const format = ADDRESS_FORMATS[code];

            return {
                code,
                name: names?.of(code) ?? code,
                dialCode: `+${getCountryCallingCode(code as CountryCode)}`,
                levels: format.levels,
                cityLabel: format.cityLabel,
                postcode: { ...format.postcode, pattern: format.postcode.pattern.source },
                timezones: format.timezones,
                defaultTimezone: format.timezones[0],
                regions: publicRegions(format.regions),
            };
        });
    }

    /** Validates and canonicalises an address; throws a translated 400. */
    normalize(input: AddressInput): NormalizedAddress {
        const result = this.check(input);

        if ("problem" in result) {
            throw this.badRequest(result.problem);
        }

        return result.address;
    }

    /** Same rules as {@link normalize}, without throwing. */
    isValid(input: AddressInput): boolean {
        return "address" in this.check(input);
    }

    /** Throws unless `timezone` is one of the country's timezones (the form's dropdown). */
    assertTimezone(countryCode: string, timezone: string): void {
        const format = this.format(countryCode);

        if (!format?.timezones.includes(timezone)) {
            throw this.badRequest({
                key: "address.errors.timezoneNotAllowed",
                args: { timezone, allowed: format?.timezones.join(", ") ?? "-" },
            });
        }
    }

    private check(input: AddressInput): { address: NormalizedAddress } | { problem: Problem } {
        const format = this.format(input.countryCode);

        if (!format) {
            return {
                problem: {
                    key: "address.errors.unsupportedCountry",
                    args: { country: input.countryCode, allowed: this.countries.join(", ") },
                },
            };
        }

        const state = findRegion(format.regions, input.stateCode);

        if (!state) {
            return {
                problem: { key: "address.errors.invalidRegion", args: { label: format.levels[0] } },
            };
        }

        let district: RegionDef | undefined;

        if (state.children?.length) {
            district = findRegion(state.children, input.districtCode);

            if (!district) {
                const label = format.levels[1] ?? "District";

                return {
                    problem: input.districtCode
                        ? { key: "address.errors.invalidSubRegion", args: { label, parent: state.name } }
                        : { key: "address.errors.regionRequired", args: { label } },
                };
            }
        }

        const pincode = (input.pincode ?? "").trim().toUpperCase();
        const { label, pattern, example, required } = format.postcode;

        if (!pincode && required) {
            return { problem: { key: "address.errors.postcodeRequired", args: { label } } };
        }

        if (pincode && !pattern.test(pincode)) {
            return { problem: { key: "address.errors.invalidPostcode", args: { label, example } } };
        }

        return {
            address: {
                countryCode: format.code,
                stateCode: state.code,
                state: state.name,
                districtCode: district?.code ?? null,
                district: district?.name ?? null,
                pincode,
            },
        };
    }

    private badRequest({ key, args }: Problem) {
        return new BadRequestException({
            message: this.i18n.translate(key, { args }),
            code: key.split(".").pop()!.replace(/[A-Z]/g, (c) => `_${c}`).toUpperCase(),
        });
    }

    // ─── Reverse geocoding ────────────────────────────────────────────────────

    /**
     * Pin → address prefill. Cached per ~11 m cell (4 dp) and language, so the
     * same spot (or every admin editing the same store) costs one Google call.
     */
    async reverseGeocode(lat: number, lng: number, language = "en"): Promise<GeocodedAddress | null> {
        const key = `geo:reverse:${language}:${lat.toFixed(4)}:${lng.toFixed(4)}`;
        const cached = await this.redis.getJson<{ value: GeocodedAddress | null }>(key);

        if (cached) {
            return cached.value;
        }

        if (!this.geocodeKey) {
            throw new ServiceUnavailableException({
                message: this.i18n.translate("address.errors.geocodeUnavailable"),
                code: "GEOCODE_UNAVAILABLE",
            });
        }

        const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
        url.search = new URLSearchParams({
            latlng: `${lat},${lng}`,
            language,
            key: this.geocodeKey,
        }).toString();

        let body: GoogleGeocodeResponse;

        try {
            const response = await fetch(url, { signal: AbortSignal.timeout(5_000) });
            body = (await response.json()) as GoogleGeocodeResponse;
        } catch {
            throw this.geocodeFailed();
        }

        // Quota / key errors are not cached so they can be retried.
        if (body.status !== "OK" && body.status !== "ZERO_RESULTS") {
            throw this.geocodeFailed();
        }

        const value =
            body.status === "OK" && body.results[0] ? this.toAddress(body.results[0], lat, lng) : null;

        await this.redis.setJson(key, { value }, this.geocodeTtlSec);

        return value;
    }

    private geocodeFailed() {
        return new BadGatewayException({
            message: this.i18n.translate("address.errors.geocodeFailed"),
            code: "GEOCODE_FAILED",
        });
    }

    private toAddress(
        result: GoogleGeocodeResponse["results"][number],
        lat: number,
        lng: number,
    ): GeocodedAddress {
        const get = (type: string, short = false) => {
            const part = result.address_components.find((c) => c.types.includes(type));
            return part ? (short ? part.short_name : part.long_name) : undefined;
        };

        const countryCode = get("country", true) ?? "";
        const format = this.format(countryCode);
        const level1 = get("administrative_area_level_1");
        const level2 = get("administrative_area_level_2");
        const state = format
            ? (findRegion(format.regions, get("administrative_area_level_1", true)) ??
              findRegion(format.regions, level1))
            : undefined;
        const district = findRegion(state?.children, level2);

        const street = [get("street_number"), get("route")].filter(Boolean).join(" ");
        const addressLine = [
            get("premise"),
            street,
            get("sublocality_level_2"),
            get("sublocality_level_1") ?? get("neighborhood"),
        ]
            .filter(Boolean)
            .join(", ");

        return {
            formattedAddress: result.formatted_address,
            placeId: result.place_id,
            countryCode,
            supported: !!format,
            stateCode: state?.code ?? null,
            state: state?.name ?? level1 ?? null,
            districtCode: district?.code ?? null,
            district: district?.name ?? (state?.children ? (level2 ?? null) : null),
            city:
                get("locality") ??
                get("postal_town") ??
                get("administrative_area_level_3") ??
                level2 ??
                null,
            addressLine: addressLine || null,
            pincode: get("postal_code") ?? null,
            latitude: lat,
            longitude: lng,
        };
    }
}

@Global()
@Module({
    providers: [AddressService],
    exports: [AddressService],
})
export class AddressModule {}
