import { P } from "@common/authorization/permissions";
import { StoreScopeService } from "@common/authorization/store-scope.service";
import { CurrentUser, Permissions } from "@common/decorators/auth.decorator";
import { AuthUser } from "@common/types/auth.type";
import {
    OperationalDto,
    StoreChargesDto,
    ToggleChargeDto,
} from "../../admin/stores/stores.dto";
import { StoresService } from "@modules/stores/stores.service";
import {
    ApiMyStoreGet,
    ApiMyStoreStatus,
    ApiMyStoreUpdate,
    ApiReplaceStoreCharges,
    ApiStoreCharges,
    ApiToggleStoreCharge,
} from "../../admin/stores/stores.swagger";
import { Body, Get, Param, Patch, Put } from "@nestjs/common";
import { StoreController } from "../store-controller.decorator";

/** Store manager: their own store, operational fields only. */
@StoreController("profile", "Store profile", {
    managerOnly: true,
    forbidden:
        "Role is not STORE_MANAGER, the permission is missing, or no store is assigned",
})
export class StoreProfileController {
    constructor(
        private readonly stores: StoresService,
        private readonly storeScope: StoreScopeService,
    ) {}

    @Permissions(P.STORE_READ)
    @ApiMyStoreGet()
    @Get()
    mine(@CurrentUser() user: AuthUser) {
        return this.stores.get(this.storeScope.scope(user));
    }

    @Permissions(P.STORE_UPDATE)
    @ApiMyStoreUpdate()
    @Patch()
    updateMine(@CurrentUser() user: AuthUser, @Body() dto: OperationalDto) {
        return this.stores.updateOperational(this.storeScope.scope(user), dto);
    }

    @Permissions(P.STORE_READ)
    @ApiMyStoreStatus()
    @Get("status")
    status(@CurrentUser() user: AuthUser) {
        return this.stores.operatingStatus(this.storeScope.scope(user));
    }

    @Permissions(P.STORE_READ)
    @ApiStoreCharges()
    @Get("charges")
    charges(@CurrentUser() user: AuthUser) {
        return this.stores.charges(this.storeScope.scope(user));
    }

    @Permissions(P.STORE_UPDATE)
    @ApiReplaceStoreCharges()
    @Put("charges")
    replaceCharges(
        @CurrentUser() user: AuthUser,
        @Body() dto: StoreChargesDto,
    ) {
        return this.stores.replaceCharges(
            this.storeScope.scope(user),
            dto.charges,
        );
    }

    @Permissions(P.STORE_UPDATE)
    @ApiToggleStoreCharge()
    @Patch("charges/:chargeId")
    toggleCharge(
        @CurrentUser() user: AuthUser,
        @Param("chargeId") chargeId: string,
        @Body() dto: ToggleChargeDto,
    ) {
        return this.stores.toggleCharge(
            this.storeScope.scope(user),
            chargeId,
            dto.isActive,
        );
    }
}
