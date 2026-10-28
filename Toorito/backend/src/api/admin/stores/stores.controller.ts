import { P } from "@common/authorization/permissions";
import { Permissions } from "@common/decorators/auth.decorator";
import { pageParams } from "@common/utils/helpers.util";
import { AddressService } from "@core/address/address.service";
import { ParseBigIntPipe } from "@core/http/pipes/parse-bigint.pipe";
import {
    CodeCheckQueryDto,
    CreateStoreDto,
    LatLngDto,
    ListStoresQuery,
    ToggleChargeDto,
    UpdateStoreDto,
} from "./stores.dto";
import { StoresService } from "@modules/stores/stores.service";
import {
    ApiAdminStoreGet,
    ApiAdminStoreIdParam,
    ApiAdminStoreList,
    ApiCheckStoreCode,
    ApiCreateStore,
    ApiDeleteStore,
    ApiGeocodeStorePin,
    ApiStoreCharges,
    ApiToggleStoreCharge,
    ApiStoreMeta,
    ApiUpdateStore,
} from "./stores.swagger";
import {
    Body,
    Delete,
    Get,
    Header,
    Param,
    Patch,
    Post,
    Query,
} from "@nestjs/common";
import { I18nLang } from "nestjs-i18n";
import { AdminController } from "../admin-controller.decorator";

/** Admin store management. */
@AdminController("stores", "Stores")
export class AdminStoresController {
    constructor(
        private readonly stores: StoresService,
        private readonly address: AddressService,
    ) {}

    // Form helpers — must stay ABOVE ":id", otherwise they are parsed as ids.

    @Permissions(P.STORE_READ)
    @ApiStoreMeta()
    @Header("Cache-Control", "private, max-age=3600")
    @Get("meta")
    meta(@I18nLang() lang: string) {
        return this.stores.meta(lang);
    }

    @Permissions(P.STORE_READ)
    @ApiCheckStoreCode()
    @Get("code-check")
    checkCode(@Query() query: CodeCheckQueryDto) {
        return this.stores.checkCode(query);
    }

    @Permissions(P.STORE_READ)
    @ApiGeocodeStorePin()
    @Get("geocode")
    geocode(@Query() query: LatLngDto, @I18nLang() lang: string) {
        return this.address.reverseGeocode(query.lat, query.lng, lang);
    }

    // CRUD

    @Permissions(P.STORE_READ)
    @ApiAdminStoreList()
    @Get()
    list(@Query() query: ListStoresQuery) {
        return this.stores.list({
            status: query.status,
            serviceMode: query.serviceMode,
            countryCode: query.countryCode,
            q: query.q,
            sort: query.sort,
            ...pageParams(query),
        });
    }

    @Permissions(P.STORE_READ)
    @ApiAdminStoreGet()
    @Get(":id")
    get(@Param("id", ParseBigIntPipe) id: bigint) {
        return this.stores.get(id);
    }

    @Permissions(P.STORE_CREATE)
    @ApiCreateStore()
    @Post()
    create(@Body() dto: CreateStoreDto) {
        return this.stores.create(dto);
    }

    /** One endpoint for every edit: identity, address, boundary, cart rules, charges, status, switches. */
    @Permissions(P.STORE_UPDATE)
    @ApiUpdateStore()
    @Patch(":id")
    update(
        @Param("id", ParseBigIntPipe) id: bigint,
        @Body() dto: UpdateStoreDto,
    ) {
        return this.stores.update(id, dto);
    }

    @Permissions(P.STORE_READ)
    @ApiAdminStoreIdParam()
    @ApiStoreCharges()
    @Get(":id/charges")
    charges(@Param("id", ParseBigIntPipe) id: bigint) {
        return this.stores.charges(id);
    }

    @Permissions(P.STORE_UPDATE)
    @ApiAdminStoreIdParam()
    @ApiToggleStoreCharge()
    @Patch(":id/charges/:chargeId")
    toggleCharge(
        @Param("id", ParseBigIntPipe) id: bigint,
        @Param("chargeId") chargeId: string,
        @Body() dto: ToggleChargeDto,
    ) {
        return this.stores.toggleCharge(id, chargeId, dto.isActive);
    }

    @Permissions(P.STORE_DELETE)
    @ApiDeleteStore()
    @Delete(":id")
    remove(@Param("id", ParseBigIntPipe) id: bigint) {
        return this.stores.remove(id);
    }
}
