import { CurrentUser } from "@common/decorators/auth.decorator";
import { AuthUser } from "@common/types/auth.type";
import { pageParams } from "@common/utils/helpers.util";
import { ParseBigIntPipe } from "@core/http/pipes/parse-bigint.pipe";
import { WishlistCheckQuery, WishlistQuery } from "../../admin/users/users.dto";
import { UsersService } from "@modules/users/users.service";
import {
    ApiAddToWishlist,
    ApiMyWishlist,
    ApiRemoveFromWishlist,
    ApiWishlistCheck,
} from "../../admin/users/users.swagger";
import { Delete, Get, Param, Put, Query } from "@nestjs/common";
import { I18nLang } from "nestjs-i18n";
import { AppController } from "../app-controller.decorator";

/** Any signed-in user: own profile, settings, avatar, phone, wallet; customers: wishlist. */
@AppController("wishlist", "Wishlist", "customer")
export class AppWishlistController {
    constructor(private readonly users: UsersService) {}

    @ApiMyWishlist()
    @Get()
    wishlist(
        @CurrentUser() user: AuthUser,
        @Query() query: WishlistQuery,
        @I18nLang() lang: string,
    ) {
        return this.users.wishlist(user.id, lang, {
            ...query,
            ...pageParams(query),
        });
    }

    // Must stay ABOVE "wishlist/:productId".
    @ApiWishlistCheck()
    @Get("check")
    wishlistCheck(
        @CurrentUser() user: AuthUser,
        @Query() query: WishlistCheckQuery,
    ) {
        return this.users.wishlistCheck(user.id, query.productIds);
    }

    @ApiAddToWishlist()
    @Put(":productId")
    addToWishlist(
        @CurrentUser() user: AuthUser,
        @Param("productId", ParseBigIntPipe) productId: bigint,
    ) {
        return this.users.addToWishlist(user.id, productId);
    }

    @ApiRemoveFromWishlist()
    @Delete(":productId")
    removeFromWishlist(
        @CurrentUser() user: AuthUser,
        @Param("productId", ParseBigIntPipe) productId: bigint,
    ) {
        return this.users.removeFromWishlist(user.id, productId);
    }
}
