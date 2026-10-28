import {
    bboxOfPoints,
    bboxOfRadius,
    farthestFrom,
    haversineM,
    isSelfIntersecting,
    LatLng,
    normalizeRing,
    pointInPolygon,
    ringAreaM2,
} from "@common/utils/geo.util";
import { normalizeSearch, toBigInt } from "@common/utils/helpers.util";
import { AppConfig } from "@config/config.type";
import { AddressInput, AddressService } from "@core/address/address.service";
import { PrismaService } from "@core/database/prisma.service";
import { LocaleMap, LocaleService } from "@core/locale/locale.service";
import { RedisService } from "@core/redis/redis.service";
import {
    StoreAreaInput,
    CodeCheckQueryInput,
    CreateStoreInput,
    OperationalInput,
    StoreChargeInput,
    UpdateStoreInput,
} from "./stores.types";
import {
    ChargeCalc,
    ChargeKind,
    ChargeTrigger,
    chargesOf,
    isChargeLive,
    isWithinOpeningHours,
    isValidStoreCode,
    normalizeStoreCode,
    STORE_CODE_PREFIX,
    STORE_LIMITS,
    StoreCharge,
    storeCodeStem,
} from "./stores.util";
import {
    BadRequestException,
    ConflictException,
    Injectable,
    NotFoundException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Prisma, StoreServiceMode, StoreStatus } from "@prisma-client/client";
import { I18nService } from "nestjs-i18n";
import { randomUUID } from "node:crypto";

// ─── Field groups ────────────────────────────────────────────────────────────

/** What a store manager may change (PATCH store/profile). */
const OPERATIONAL_KEYS = [
    "isOpen",
    "acceptingOrders",
    "openingHours",
    "avgPrepMinutes",
    "minOrderValue",
    "deliveryFee",
    "freeDeliveryAbove",
    "handlingFee",
    "smallCartLimit",
    "smallCartFee",
    "phone",
] as const satisfies readonly (keyof OperationalInput)[];

/** Admin-only columns copied as-is on update. */
const DETAIL_KEYS = [
    "email",
    "licenseNumber",
    "city",
    "addressLine",
    "addressLine2",
    "placeId",
    "latitude",
    "longitude",
    "serviceMode",
] as const satisfies readonly (keyof UpdateStoreInput)[];

/** `null` on these would violate NOT NULL, so it is treated as "not sent". */
const NON_NULLABLE = new Set<string>([
    "isOpen", "acceptingOrders", "avgPrepMinutes", "minOrderValue", "deliveryFee",
    "handlingFee", "name", "timezone", "status", "countryCode", "stateCode", "city",
    "addressLine", "pincode", "latitude", "longitude", "serviceMode", "serviceRadiusM",
    "areas", "charges",
]);

const withoutNulls = <T extends object>(dto: T): T =>
    Object.fromEntries(
        Object.entries(dto).filter(([key, value]) => !(value === null && NON_NULLABLE.has(key))),
    ) as T;

/** Copies the listed keys that are not `undefined`. */
function pickDefined<T extends object, K extends keyof T>(object: T, keys: readonly K[]) {
    const out: Partial<Pick<T, K>> = {};

    for (const key of keys) {
        if (object[key] !== undefined) out[key] = object[key];
    }

    return out;
}

const bboxFields = (bbox: { minLat: number; maxLat: number; minLng: number; maxLng: number }) => ({
    bboxMinLat: bbox.minLat,
    bboxMaxLat: bbox.maxLat,
    bboxMinLng: bbox.minLng,
    bboxMaxLng: bbox.maxLng,
});

const newChargeId = () => randomUUID().replace(/-/g, "").slice(0, 12);

// ─── Selects ─────────────────────────────────────────────────────────────────

const DETAIL_INCLUDE = {
    areas: { where: { isActive: true }, orderBy: { id: "asc" } },
    _count: { select: { members: true, storeProducts: true } },
} satisfies Prisma.StoreInclude;

const PUBLIC_SELECT = {
    id: true,
    code: true,
    name: true,
    latitude: true,
    longitude: true,
    isOpen: true,
    acceptingOrders: true,
    avgPrepMinutes: true,
    minOrderValue: true,
    deliveryFee: true,
    freeDeliveryAbove: true,
    handlingFee: true,
    smallCartLimit: true,
    smallCartFee: true,
    openingHours: true,
    timezone: true,
    charges: true,
} satisfies Prisma.StoreSelect;

type AreaInput = Pick<StoreAreaInput, "name" | "polygon"> & Partial<StoreAreaInput>;

interface ReadinessInput extends AddressInput {
    phone: string | null;
    serviceMode: StoreServiceMode;
    serviceRadiusM: number | null;
    areaCount: number;
    logoId: bigint | null;
    openingHours: unknown;
    members: number;
    products: number;
}

@Injectable()
export class StoresService {
    /** How long "location -> store" answers are cached (`CACHE_STORE_GEO_TTL_SEC`). */
    private readonly geoTtlSec: number;
    private readonly phoneCountries: string[];

    constructor(
        private readonly prisma: PrismaService,
        private readonly redis: RedisService,
        private readonly i18n: I18nService,
        private readonly locale: LocaleService,
        private readonly address: AddressService,
        config: ConfigService,
    ) {
        this.geoTtlSec = config.getOrThrow<AppConfig["cache"]>("cache").ttlSec.storeGeo;
        this.phoneCountries = config.getOrThrow<AppConfig["phone"]>("phone").allowedCountries;
    }

    // ─── Errors ──────────────────────────────────────────────────────────────

    private bad(key: string, args?: Record<string, unknown>): never {
        throw new BadRequestException({
            message: this.i18n.translate(`stores.errors.${key}`, { args }),
            code: key.replace(/[A-Z]/g, (c) => `_${c}`).toUpperCase(),
        });
    }

    private notFound(key = "notFound"): never {
        throw new NotFoundException(this.i18n.translate(`stores.errors.${key}`));
    }

    // ─── Form helpers ────────────────────────────────────────────────────────

    /** Everything the Add/Edit Store form needs to render without extra calls. */
    meta(language?: string) {
        return {
            defaultLanguage: this.locale.defaultLanguage,
            languages: this.locale.languages,
            codePrefix: STORE_CODE_PREFIX,
            phoneCountries: this.phoneCountries,
            countries: this.address.catalog(language ?? this.locale.defaultLanguage),
            enums: {
                status: Object.values(StoreStatus),
                serviceMode: Object.values(StoreServiceMode),
                chargeKind: Object.values(ChargeKind),
                chargeCalc: Object.values(ChargeCalc),
                chargeTrigger: Object.values(ChargeTrigger),
            },
            limits: STORE_LIMITS,
        };
    }

    /** Availability of a code plus free suggestions in the DS-CTY-ARE01 pattern. */
    async checkCode(query: CodeCheckQueryInput) {
        const code = query.code ? normalizeStoreCode(query.code) : null;
        const valid = code ? isValidStoreCode(code) : null;
        const available = code && valid ? !(await this.codeExists(code)) : null;

        let suggestions: string[] = [];

        if (!available) {
            const stem = code && valid ? code.replace(/\d+$/, "") : storeCodeStem(query.city, query.name);

            if (stem) {
                suggestions = await this.suggestCodes(stem);
            }
        }

        return { code, valid, available, suggestions };
    }

    private async codeExists(code: string) {
        const found = await this.prisma.store.findFirst({
            where: { code: { equals: code, mode: "insensitive" } },
            select: { id: true },
        });

        return !!found;
    }

    private async suggestCodes(stem: string, count = 3) {
        const rows = await this.prisma.store.findMany({
            where: { code: { startsWith: stem, mode: "insensitive" } },
            select: { code: true },
        });
        const taken = new Set(rows.map((row) => row.code.toUpperCase()));
        const out: string[] = [];

        for (let n = 1; n <= 999 && out.length < count; n++) {
            const candidate = `${stem}${String(n).padStart(2, "0")}`;
            if (candidate.length <= 30 && !taken.has(candidate)) out.push(candidate);
        }

        return out;
    }

    // ─── Validation helpers ──────────────────────────────────────────────────

    /** Cleaned multi-language name plus its search/sort text (default language first). */
    private nameFields(name: LocaleMap) {
        const clean = this.locale.cleanMap(name, "name")!;
        const first = clean[this.locale.defaultLanguage] ?? "";
        const others = Object.entries(clean)
            .filter(([language]) => language !== this.locale.defaultLanguage)
            .map(([, text]) => text);

        return {
            name: clean,
            nameSearch: normalizeSearch([first, ...others].join(" | ")).slice(0, 500),
        };
    }

    /** Operational columns that were sent, ready for Prisma (JSON null handled). */
    private operationalData(dto: OperationalInput) {
        const { openingHours, ...rest } = pickDefined(dto, OPERATIONAL_KEYS);

        return {
            ...rest,
            ...(openingHours === undefined
                ? {}
                : {
                      openingHours:
                          openingHours === null
                              ? Prisma.DbNull
                              : (openingHours as Prisma.InputJsonValue),
                  }),
        };
    }

    /** Validates radius / polygons and returns the bbox plus cleaned polygons. */
    private boundary(
        mode: StoreServiceMode,
        center: LatLng,
        radius: number | null | undefined,
        areas: AreaInput[] | undefined,
    ) {
        if (mode === StoreServiceMode.RADIUS) {
            if (!radius) this.bad("serviceRadiusRequired");
            return { bbox: bboxOfRadius(center, radius), areas: [] as AreaInput[] };
        }

        if (!areas?.length) this.bad("areaRequired");
        if (areas.length > STORE_LIMITS.maxAreas) {
            this.bad("tooManyAreas", { max: STORE_LIMITS.maxAreas });
        }

        const clean = areas.map((area, index) => {
            const label = area.name || `#${index + 1}`;
            const ring = normalizeRing(area.polygon);

            if (ring.length < 3) this.bad("polygonTooFewPoints", { area: label });
            if (ring.length > STORE_LIMITS.maxPolygonPoints) {
                this.bad("polygonTooManyPoints", { area: label, max: STORE_LIMITS.maxPolygonPoints });
            }
            if (isSelfIntersecting(ring)) this.bad("polygonSelfIntersecting", { area: label });
            if (ringAreaM2(ring) < STORE_LIMITS.minAreaM2) {
                this.bad("polygonTooSmall", { area: label, min: STORE_LIMITS.minAreaM2 });
            }
            if (farthestFrom(center, ring) > STORE_LIMITS.maxAreaDistanceM) {
                this.bad("polygonTooFar", { area: label, max: STORE_LIMITS.maxAreaDistanceM / 1000 });
            }

            return { ...area, polygon: ring };
        });

        return { bbox: bboxOfPoints(clean.flatMap((area) => area.polygon)), areas: clean };
    }

    private areaRows(areas: AreaInput[]) {
        return areas.map((area) => {
            const bbox = bboxOfPoints(area.polygon);

            return {
                name: area.name,
                placeId: area.placeId,
                polygon: area.polygon as unknown as Prisma.InputJsonValue,
                minLat: bbox.minLat,
                maxLat: bbox.maxLat,
                minLng: bbox.minLng,
                maxLng: bbox.maxLng,
                deliveryFeeOverride: area.deliveryFeeOverride,
            };
        });
    }

    private commercials(values: { smallCartFee?: unknown; smallCartLimit?: unknown }) {
        const fee = values.smallCartFee == null ? 0 : Number(values.smallCartFee);

        if (fee > 0 && values.smallCartLimit == null) {
            this.bad("smallCartLimitRequired");
        }
    }

    /** Validates the charge list and returns what is stored in Store.charges. */
    private normalizeCharges(charges: StoreChargeInput[]): Prisma.InputJsonValue {
        const kinds = new Set<ChargeKind>();
        const ids = new Set<string>();

        const list = charges.map((charge): StoreCharge => {
            if (charge.kind === ChargeKind.CUSTOM) {
                if (!charge.label) this.bad("chargeLabelRequired");
            } else {
                if (kinds.has(charge.kind)) this.bad("chargeDuplicateKind", { kind: charge.kind });
                kinds.add(charge.kind);
            }

            if (charge.calc === ChargeCalc.PERCENT && charge.amount > 100) {
                this.bad("chargePercentTooHigh");
            }

            const scheduled = charge.trigger === ChargeTrigger.SCHEDULE;

            if (scheduled && (!charge.schedule || charge.schedule.from === charge.schedule.to)) {
                this.bad("chargeScheduleRequired");
            }

            // Keep the client's id when unique, so the UI can track rows across saves.
            const id = charge.id && !ids.has(charge.id) ? charge.id : newChargeId();
            ids.add(id);

            return {
                id,
                kind: charge.kind,
                label: charge.label ? (this.locale.cleanMap(charge.label, "label", false) ?? null) : null,
                calc: charge.calc,
                amount: charge.amount,
                maxAmount: charge.calc === ChargeCalc.PERCENT ? (charge.maxAmount ?? null) : null,
                trigger: charge.trigger,
                schedule: scheduled
                    ? { days: charge.schedule!.days ?? [], from: charge.schedule!.from, to: charge.schedule!.to }
                    : null,
                isActive: charge.isActive ?? scheduled,
            };
        });

        return list as unknown as Prisma.InputJsonValue;
    }

    // ─── Readiness ───────────────────────────────────────────────────────────

    /** Blocking checks gate activation; the rest are setup reminders for the UI. */
    private readinessOf(store: ReadinessInput) {
        const checks = [
            { key: "address", blocking: true, ok: this.address.isValid(store) },
            { key: "phone", blocking: true, ok: !!store.phone },
            {
                key: "boundary",
                blocking: true,
                ok: store.serviceMode === StoreServiceMode.RADIUS ? !!store.serviceRadiusM : store.areaCount > 0,
            },
            {
                key: "openingHours",
                blocking: false,
                ok: !!store.openingHours && Object.keys(store.openingHours as object).length > 0,
            },
            { key: "logo", blocking: false, ok: !!store.logoId },
            { key: "staff", blocking: false, ok: store.members > 0 },
            { key: "catalog", blocking: false, ok: store.products > 0 },
        ];

        return { ready: checks.every((check) => !check.blocking || check.ok), checks };
    }

    private assertReady(readiness: ReturnType<StoresService["readinessOf"]>) {
        if (!readiness.ready) {
            const missing = readiness.checks.filter((c) => c.blocking && !c.ok).map((c) => c.key);
            this.bad("notReady", { missing: missing.join(", ") });
        }
    }

    // ─── CRUD ────────────────────────────────────────────────────────────────

    async create(input: CreateStoreInput) {
        const dto = withoutNulls(input);

        const code = normalizeStoreCode(dto.code);
        if (!isValidStoreCode(code)) this.bad("codeInvalid");

        const address = this.address.normalize(dto);
        const timezone = dto.timezone ?? this.address.format(address.countryCode)!.timezones[0];
        this.address.assertTimezone(address.countryCode, timezone);

        const center = { lat: dto.latitude, lng: dto.longitude };
        const boundary = this.boundary(dto.serviceMode, center, dto.serviceRadiusM, dto.areas);
        const isArea = dto.serviceMode === StoreServiceMode.AREA;

        this.commercials(dto);
        const charges = this.normalizeCharges(dto.charges ?? []);
        const status = dto.status ?? StoreStatus.DRAFT;

        if (status === StoreStatus.ACTIVE) {
            this.assertReady(
                this.readinessOf({
                    ...address,
                    phone: dto.phone ?? null,
                    serviceMode: dto.serviceMode,
                    serviceRadiusM: dto.serviceRadiusM ?? null,
                    areaCount: boundary.areas.length,
                    logoId: toBigInt(dto.logoId) ?? null,
                    openingHours: dto.openingHours,
                    members: 0,
                    products: 0,
                }),
            );
        }

        const data: Prisma.StoreUncheckedCreateInput = {
            ...this.operationalData(dto),
            ...this.nameFields(dto.name),
            ...address,
            ...bboxFields(boundary.bbox),
            code,
            status,
            timezone,
            email: dto.email ?? null,
            licenseNumber: dto.licenseNumber ?? null,
            logoId: toBigInt(dto.logoId) ?? null,
            city: dto.city,
            addressLine: dto.addressLine,
            addressLine2: dto.addressLine2 ?? null,
            placeId: dto.placeId ?? null,
            latitude: dto.latitude,
            longitude: dto.longitude,
            serviceMode: dto.serviceMode,
            serviceRadiusM: isArea ? null : dto.serviceRadiusM,
            charges,
            areas: isArea ? { create: this.areaRows(boundary.areas) } : undefined,
        };

        let id: bigint;

        try {
            ({ id } = await this.prisma.store.create({ data, select: { id: true } }));
        } catch (error) {
            if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
                throw new ConflictException({
                    message: this.i18n.translate("stores.errors.codeTaken", { args: { code } }),
                    code: "CODE_TAKEN",
                });
            }
            throw error;
        }

        // Only active stores take part in location → store resolution.
        if (status === StoreStatus.ACTIVE) await this.invalidate();

        return this.get(id);
    }

    async update(id: bigint, input: UpdateStoreInput) {
        const current = await this.prisma.store.findUnique({
            where: { id },
            include: {
                areas: { where: { isActive: true } },
                _count: { select: { members: true, storeProducts: true } },
            },
        });

        if (!current) this.notFound();

        const dto = withoutNulls(input);
        const data: Prisma.StoreUncheckedUpdateInput = {
            ...this.operationalData(dto),
            ...pickDefined(dto, DETAIL_KEYS),
        };

        if (dto.status) data.status = dto.status;
        if (dto.name) Object.assign(data, this.nameFields(dto.name));
        if (dto.logoId !== undefined) data.logoId = toBigInt(dto.logoId) ?? null;

        // Address: any part changed → the whole address is re-validated.
        const addressTouched =
            dto.countryCode !== undefined ||
            dto.stateCode !== undefined ||
            dto.districtCode !== undefined ||
            dto.pincode !== undefined;

        const address: AddressInput = addressTouched
            ? this.address.normalize({
                  countryCode: dto.countryCode ?? current.countryCode,
                  stateCode: dto.stateCode ?? current.stateCode,
                  districtCode: dto.districtCode !== undefined ? dto.districtCode : current.districtCode,
                  pincode: dto.pincode ?? current.pincode,
              })
            : current;

        if (addressTouched) {
            Object.assign(data, address);
        }

        // Timezone must be one of the (new) country's timezones.
        if (dto.timezone) {
            this.address.assertTimezone(address.countryCode, dto.timezone);
            data.timezone = dto.timezone;
        } else if (addressTouched) {
            const zones = this.address.format(address.countryCode)!.timezones;
            if (!zones.includes(current.timezone)) data.timezone = zones[0];
        }

        // Delivery boundary
        const mode = dto.serviceMode ?? current.serviceMode;
        const radius = dto.serviceRadiusM ?? current.serviceRadiusM;
        const geoChanged =
            dto.serviceMode !== undefined ||
            dto.latitude !== undefined ||
            dto.longitude !== undefined ||
            dto.serviceRadiusM !== undefined ||
            dto.areas !== undefined;

        let newAreas: AreaInput[] | null = null;

        if (geoChanged) {
            const center = {
                lat: dto.latitude ?? Number(current.latitude),
                lng: dto.longitude ?? Number(current.longitude),
            };
            const existing = current.areas.map((area) => ({
                name: area.name,
                polygon: area.polygon as unknown as LatLng[],
            }));
            const boundary = this.boundary(mode, center, radius, dto.areas ?? existing);

            Object.assign(data, bboxFields(boundary.bbox), {
                serviceRadiusM: mode === StoreServiceMode.RADIUS ? radius : null,
            });

            if (mode === StoreServiceMode.AREA && dto.areas) newAreas = boundary.areas;
        }

        // Commercials & charges
        this.commercials({
            smallCartFee: dto.smallCartFee !== undefined ? dto.smallCartFee : current.smallCartFee,
            smallCartLimit: dto.smallCartLimit !== undefined ? dto.smallCartLimit : current.smallCartLimit,
        });

        if (dto.charges) data.charges = this.normalizeCharges(dto.charges);

        // Activation gate
        if (dto.status === StoreStatus.ACTIVE && current.status !== StoreStatus.ACTIVE) {
            this.assertReady(
                this.readinessOf({
                    countryCode: address.countryCode,
                    stateCode: address.stateCode,
                    districtCode: address.districtCode,
                    pincode: address.pincode,
                    phone: dto.phone !== undefined ? dto.phone : current.phone,
                    serviceMode: mode,
                    serviceRadiusM: radius,
                    areaCount: mode === StoreServiceMode.AREA ? (newAreas ?? current.areas).length : 0,
                    logoId: dto.logoId !== undefined ? (toBigInt(dto.logoId) ?? null) : current.logoId,
                    openingHours: dto.openingHours !== undefined ? dto.openingHours : current.openingHours,
                    members: current._count.members,
                    products: current._count.storeProducts,
                }),
            );
        }

        await this.prisma.$transaction(async (tx) => {
            const leavingAreaMode =
                mode === StoreServiceMode.RADIUS && current.serviceMode === StoreServiceMode.AREA;

            if (newAreas || leavingAreaMode) {
                await tx.storeServiceArea.deleteMany({ where: { storeId: id } });
            }

            if (newAreas) {
                await tx.storeServiceArea.createMany({
                    data: this.areaRows(newAreas).map((area) => ({ ...area, storeId: id })),
                });
            }

            await tx.store.update({ where: { id }, data });
        });

        // Resolution depends only on geo + status; skip the cache wipe otherwise.
        if (geoChanged || (dto.status !== undefined && dto.status !== current.status)) {
            await this.invalidate();
        }

        return this.get(id);
    }

    /**
     * Permanently deletes a store that never traded.
     *
     * - ACTIVE stores must be deactivated first (customers may be ordering).
     * - Stores with orders cannot be deleted (order history must stay); set
     *   them INACTIVE instead.
     * - Areas, store products, bundles cascade; carts and staff are detached.
     */
    async remove(id: bigint) {
        const store = await this.prisma.store.findUnique({
            where: { id },
            select: { id: true, code: true, status: true, _count: { select: { orders: true, members: true } } },
        });

        if (!store) this.notFound();

        if (store.status === StoreStatus.ACTIVE) {
            throw new ConflictException({
                message: this.i18n.translate("stores.errors.deleteActive"),
                code: "STORE_ACTIVE",
            });
        }

        if (store._count.orders > 0) {
            throw new ConflictException({
                message: this.i18n.translate("stores.errors.deleteHasOrders", {
                    args: { count: store._count.orders },
                }),
                code: "STORE_HAS_ORDERS",
            });
        }

        try {
            await this.prisma.store.delete({ where: { id } });
        } catch (error) {
            // Another table still references the store's rows (stock history, receipts …).
            if (error instanceof Prisma.PrismaClientKnownRequestError && ["P2003", "P2014"].includes(error.code)) {
                throw new ConflictException({
                    message: this.i18n.translate("stores.errors.deleteInUse"),
                    code: "STORE_IN_USE",
                });
            }
            throw error;
        }

        await this.invalidate();

        return { success: true, id: store.id, code: store.code, detachedMembers: store._count.members };
    }

    /** Store manager: operational fields only (no location, mode or status). */
    async updateOperational(id: bigint, input: OperationalInput) {
        const dto = withoutNulls(input);
        const current = await this.prisma.store.findUnique({
            where: { id },
            select: { smallCartFee: true, smallCartLimit: true },
        });

        if (!current) this.notFound();

        this.commercials({
            smallCartFee: dto.smallCartFee !== undefined ? dto.smallCartFee : current.smallCartFee,
            smallCartLimit: dto.smallCartLimit !== undefined ? dto.smallCartLimit : current.smallCartLimit,
        });

        await this.prisma.store.update({ where: { id }, data: this.operationalData(dto) });

        return this.get(id);
    }

    // ─── Surcharges & live status (store manager + admin) ────────────────────

    /** Stored surcharges, each with `isLive` = applies to carts right now. */
    async charges(id: bigint) {
        const store = await this.prisma.store.findUnique({
            where: { id },
            select: { charges: true, timezone: true },
        });

        if (!store) this.notFound();

        const now = new Date();

        return {
            timezone: store.timezone,
            charges: chargesOf(store.charges).map((charge) => ({
                ...charge,
                isLive: isChargeLive(charge, store.timezone, now),
            })),
        };
    }

    /** Replaces the whole list (same validation as the admin store edit). */
    async replaceCharges(id: bigint, charges: StoreChargeInput[]) {
        const exists = await this.prisma.store.count({ where: { id } });

        if (!exists) this.notFound();

        await this.prisma.store.update({ where: { id }, data: { charges: this.normalizeCharges(charges) } });

        return this.charges(id);
    }

    /** Switch one surcharge on / off without resending the list. */
    async toggleCharge(id: bigint, chargeId: string, isActive: boolean) {
        return this.prisma.$transaction(async (tx) => {
            // Row lock: two quick toggles must not overwrite each other's JSON.
            const [row] = await tx.$queryRaw<{ charges: unknown }[]>`
                SELECT charges FROM "Store" WHERE id = ${id} FOR UPDATE`;

            if (!row) this.notFound();

            const list = chargesOf(row.charges);
            const charge = list.find((item) => item.id === chargeId);

            if (!charge) this.notFound("chargeNotFound");

            charge.isActive = isActive;

            await tx.store.update({
                where: { id },
                data: { charges: list as unknown as Prisma.InputJsonValue },
            });
        }).then(() => this.charges(id));
    }

    /**
     * Can the store take orders right now? Combines the manual switches with
     * the opening hours (store timezone) and lists the live surcharges.
     */
    async operatingStatus(id: bigint) {
        const store = await this.prisma.store.findUnique({
            where: { id },
            select: {
                status: true,
                isOpen: true,
                acceptingOrders: true,
                openingHours: true,
                timezone: true,
                avgPrepMinutes: true,
                charges: true,
            },
        });

        if (!store) this.notFound();

        const now = new Date();
        const withinHours = isWithinOpeningHours(store.openingHours, store.timezone, now);

        return {
            status: store.status,
            isOpen: store.isOpen,
            acceptingOrders: store.acceptingOrders,
            withinOpeningHours: withinHours,
            canTakeOrders:
                store.status === StoreStatus.ACTIVE && store.isOpen && store.acceptingOrders && withinHours,
            timezone: store.timezone,
            localTime: new Intl.DateTimeFormat("en-GB", {
                timeZone: store.timezone,
                weekday: "short",
                hour: "2-digit",
                minute: "2-digit",
                hourCycle: "h23",
            }).format(now),
            openingHours: store.openingHours,
            avgPrepMinutes: store.avgPrepMinutes,
            liveCharges: chargesOf(store.charges).filter((charge) => isChargeLive(charge, store.timezone, now)),
        };
    }

    async get(id: bigint) {
        const store = await this.prisma.store.findUnique({ where: { id }, include: DETAIL_INCLUDE });

        if (!store) this.notFound();

        return {
            ...store,
            readiness: this.readinessOf({
                ...store,
                areaCount: store.areas.length,
                members: store._count.members,
                products: store._count.storeProducts,
            }),
        };
    }

    async list(q: {
        status?: StoreStatus;
        serviceMode?: StoreServiceMode;
        countryCode?: string;
        q?: string;
        sort?: string;
        skip: number;
        take: number;
        page?: number;
        limit?: number;
    }) {
        const term = q.q?.trim();
        const where: Prisma.StoreWhereInput = {
            ...(q.status ? { status: q.status } : {}),
            ...(q.serviceMode ? { serviceMode: q.serviceMode } : {}),
            ...(q.countryCode ? { countryCode: q.countryCode } : {}),
            ...(term
                ? {
                      OR: [
                          { nameSearch: { contains: normalizeSearch(term) } },
                          { code: { contains: term, mode: "insensitive" } },
                          { phone: { contains: term } },
                          { city: { contains: term, mode: "insensitive" } },
                      ],
                  }
                : {}),
        };

        const orderBy: Prisma.StoreOrderByWithRelationInput =
            q.sort === "oldest"
                ? { id: "asc" }
                : q.sort === "name_asc"
                  ? { nameSearch: "asc" }
                  : q.sort === "name_desc"
                    ? { nameSearch: "desc" }
                    : q.sort === "updated_asc"
                      ? { updatedAt: "asc" }
                      : q.sort === "updated_desc"
                        ? { updatedAt: "desc" }
                        : { id: "desc" };

        const [items, total] = await Promise.all([
            this.prisma.store.findMany({
                where,
                skip: q.skip,
                take: q.take,
                orderBy,
                include: { _count: { select: { areas: { where: { isActive: true } } } } },
            }),
            this.prisma.store.count({ where }),
        ]);

        return {
            items,
            total,
            page: q.page ?? Math.floor(q.skip / q.take) + 1,
            limit: q.limit ?? q.take,
        };
    }

    // ─── Resolution (public) ─────────────────────────────────────────────────

    /**
     * Which store serves (lat,lng)?
     *
     * 1. SQL prefilter using indexed bbox columns.
     * 2. Exact haversine / point-in-polygon check (local, no map API calls).
     * 3. Nearest matching store wins.
     *
     * The answer is cached per ~11 m coordinate cell (4 decimals).
     */
    async resolve(lat: number, lng: number) {
        const key = `store:resolve:${lat.toFixed(4)}:${lng.toFixed(4)}`;
        const cachedId = await this.redis.client.get(key);

        if (cachedId === "0") {
            return null;
        }

        if (cachedId) {
            return this.prisma.store.findUnique({ where: { id: BigInt(cachedId) }, select: PUBLIC_SELECT });
        }

        const candidates = await this.prisma.store.findMany({
            where: {
                status: StoreStatus.ACTIVE,
                bboxMinLat: { lte: lat },
                bboxMaxLat: { gte: lat },
                bboxMinLng: { lte: lng },
                bboxMaxLng: { gte: lng },
            },
            include: {
                areas: {
                    where: {
                        isActive: true,
                        minLat: { lte: lat },
                        maxLat: { gte: lat },
                        minLng: { lte: lng },
                        maxLng: { gte: lng },
                    },
                },
            },
        });

        const point = { lat, lng };
        let best: { id: bigint; d: number } | null = null;

        for (const store of candidates) {
            const distance = haversineM(point, {
                lat: Number(store.latitude),
                lng: Number(store.longitude),
            });

            const available =
                store.serviceMode === StoreServiceMode.RADIUS
                    ? distance <= (store.serviceRadiusM ?? 0)
                    : store.areas.some((area) => pointInPolygon(point, area.polygon as unknown as LatLng[]));

            if (available && (!best || distance < best.d)) {
                best = { id: store.id, d: distance };
            }
        }

        await this.redis.client.set(key, best ? best.id.toString() : "0", "EX", this.geoTtlSec);

        return best ? this.prisma.store.findUnique({ where: { id: best.id }, select: PUBLIC_SELECT }) : null;
    }

    /** Exact serviceability check for an address at checkout. */
    async serves(storeId: bigint, lat: number, lng: number) {
        const store = await this.resolve(lat, lng);

        return store && store.id === storeId ? true : await this.coversExact(storeId, lat, lng);
    }

    private async coversExact(storeId: bigint, lat: number, lng: number) {
        const store = await this.prisma.store.findUnique({
            where: { id: storeId },
            include: { areas: { where: { isActive: true } } },
        });

        if (!store || store.status !== StoreStatus.ACTIVE) {
            return false;
        }

        const point = { lat, lng };

        return store.serviceMode === StoreServiceMode.RADIUS
            ? haversineM(point, { lat: Number(store.latitude), lng: Number(store.longitude) }) <=
                  (store.serviceRadiusM ?? 0)
            : store.areas.some((area) => pointInPolygon(point, area.polygon as unknown as LatLng[]));
    }

    private invalidate() {
        return this.redis.delByPrefix("store:resolve:");
    }
}
