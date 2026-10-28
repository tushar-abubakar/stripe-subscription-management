import { CurrentUser } from "@common/decorators/auth.decorator";
import { AuthUser } from "@common/types/auth.type";
import { ParseBigIntPipe } from "@core/http/pipes/parse-bigint.pipe";
import { AddressDto } from "../../admin/users/users.dto";
import { UsersService } from "@modules/users/users.service";
import {
    ApiAddressFormat,
    ApiCreateAddress,
    ApiDeleteAddress,
    ApiListAddresses,
    ApiUpdateAddress,
} from "../../admin/users/users.swagger";
import { Body, Delete, Get, Param, Post, Put } from "@nestjs/common";
import { I18nLang } from "nestjs-i18n";
import { AppController } from "../app-controller.decorator";

/** Customer delivery addresses (validated per country). */
@AppController("addresses", "Addresses", "customer")
export class AppAddressesController {
    constructor(private readonly users: UsersService) {}

    // Must stay ABOVE ":id" routes.
    @ApiAddressFormat()
    @Get("format")
    format(@I18nLang() lang: string) {
        return this.users.addressFormat(lang);
    }

    @ApiListAddresses()
    @Get()
    list(@CurrentUser() user: AuthUser) {
        return this.users.addresses(user.id);
    }

    @ApiCreateAddress()
    @Post()
    create(@CurrentUser() user: AuthUser, @Body() dto: AddressDto) {
        return this.users.saveAddress(user.id, dto);
    }

    @ApiUpdateAddress()
    @Put(":id")
    update(
        @CurrentUser() user: AuthUser,
        @Param("id", ParseBigIntPipe) id: bigint,
        @Body() dto: AddressDto,
    ) {
        return this.users.saveAddress(user.id, dto, id);
    }

    @ApiDeleteAddress()
    @Delete(":id")
    remove(
        @CurrentUser() user: AuthUser,
        @Param("id", ParseBigIntPipe) id: bigint,
    ) {
        return this.users.deleteAddress(user.id, id);
    }
}
