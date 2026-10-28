import { ClientIp, CurrentUser } from "@common/decorators/auth.decorator";
import { AuthUser } from "@common/types/auth.type";
import { ParseBigIntPipe } from "@core/http/pipes/parse-bigint.pipe";
import { CartActor, CartService } from "@modules/cart/cart.service";
import {
    Body,
    Delete,
    Get,
    Headers,
    HttpCode,
    Param,
    Patch,
    Post,
} from "@nestjs/common";
import { ApiHeader, ApiOperation } from "@nestjs/swagger";
import { I18nLang } from "nestjs-i18n";
import { AppController } from "../app-controller.decorator";
import { AddItemDto, QuantityDto, ApplyCouponDto } from "./cart.dto";

/** Works for guests (header `x-guest-token`) and logged-in customers (Bearer token). */
@ApiHeader({
    name: "x-guest-token",
    required: false,
    description:
        "Guest cart token from POST /app/cart/guest-token. Not needed for logged-in customers (Bearer token).",
})
@AppController("cart", "Cart")
export class AppCartController {
    constructor(private readonly cart: CartService) {}

    /** Customers are identified by their account, everyone else by the guest token. */
    private actor(user: AuthUser | undefined, guestToken?: string): CartActor {
        return user?.role === "CUSTOMER" ? { userId: user.id } : { guestToken };
    }

    @Post("guest-token")
    @HttpCode(200)
    createGuestToken(@ClientIp() ip: string) {
        return this.cart.createGuestCart(ip);
    }

    @ApiOperation({ security: [{}, { bearer: [] }] })
    @Get()
    view(
        @CurrentUser() user: AuthUser,
        @Headers("x-guest-token") guestToken: string,
        @I18nLang() lang: string,
    ) {
        return this.cart.view(this.actor(user, guestToken), lang);
    }

    @ApiOperation({ security: [{}, { bearer: [] }] })
    @Post("items")
    @HttpCode(200)
    addItem(
        @CurrentUser() user: AuthUser,
        @Headers("x-guest-token") guestToken: string,
        @Body() dto: AddItemDto,
        @ClientIp() ip: string,
    ) {
        return this.cart.addItem(this.actor(user, guestToken), {
            variantId: dto.variantId ? BigInt(dto.variantId) : undefined,
            bundleId: dto.bundleId ? BigInt(dto.bundleId) : undefined,
            quantity: dto.quantity,
            storeId: BigInt(dto.storeId),
            replaceStore: dto.replaceStore,
            ip,
        });
    }

    @ApiOperation({ security: [{}, { bearer: [] }] })
    @Patch("items/:id")
    setQuantity(
        @CurrentUser() user: AuthUser,
        @Headers("x-guest-token") guestToken: string,
        @Param("id", ParseBigIntPipe) itemId: bigint,
        @Body() dto: QuantityDto,
    ) {
        return this.cart.setQuantity(
            this.actor(user, guestToken),
            itemId,
            dto.quantity,
        );
    }

    @ApiOperation({ security: [{}, { bearer: [] }] })
    @Delete("items/:id")
    removeItem(
        @CurrentUser() user: AuthUser,
        @Headers("x-guest-token") guestToken: string,
        @Param("id", ParseBigIntPipe) itemId: bigint,
    ) {
        return this.cart.setQuantity(this.actor(user, guestToken), itemId, 0);
    }

    @ApiOperation({ security: [{}, { bearer: [] }] })
    @Delete()
    clear(
        @CurrentUser() user: AuthUser,
        @Headers("x-guest-token") guestToken: string,
    ) {
        return this.cart.clear(this.actor(user, guestToken));
    }

    @ApiOperation({ security: [{}, { bearer: [] }] })
    @Post("coupon")
    @HttpCode(200)
    applyCoupon(
        @CurrentUser() user: AuthUser,
        @Headers("x-guest-token") guestToken: string,
        @Body() dto: ApplyCouponDto,
    ) {
        return this.cart.applyCoupon(this.actor(user, guestToken), dto.code);
    }

    @ApiOperation({ security: [{}, { bearer: [] }] })
    @Delete("coupon")
    removeCoupon(
        @CurrentUser() user: AuthUser,
        @Headers("x-guest-token") guestToken: string,
    ) {
        return this.cart.applyCoupon(this.actor(user, guestToken), null);
    }
}
