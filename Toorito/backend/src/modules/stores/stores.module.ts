import { AddressModule } from "@core/address/address.service";
import { StoresService } from "./stores.service";
import { Module } from "@nestjs/common";

/**
 * Stores feature module.
 *
 * - `StorefrontStoreController` — public: which store serves a location.
 * - `AdminStoreController`      — admin: create / list / edit stores.
 * - `StoreManagerController`    — store manager: their own store's operations.
 *
 * Exports `StoresService` so orders can check serviceability at checkout.
 */
@Module({
    imports: [AddressModule],
    providers: [StoresService],
    exports: [StoresService],
})
export class StoresModule {}
