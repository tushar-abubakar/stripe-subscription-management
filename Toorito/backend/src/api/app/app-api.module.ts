import { ApprovalsModule } from "@modules/approvals/approvals.module";
import { CartModule } from "@modules/cart/cart.module";
import { OrdersModule } from "@modules/orders/orders.module";
import { SduiModule } from "@modules/sdui/sdui.module";
import { StoresModule } from "@modules/stores/stores.module";
import { SupportModule } from "@modules/support/support.module";
import { UsersModule } from "@modules/users/users.module";
import { Module } from "@nestjs/common";
import { AppAddressesController } from "./addresses/addresses.controller";
import { AppCartController } from "./cart/cart.controller";
import { AppOrdersController } from "./orders/orders.controller";
import { AppReturnsController } from "./returns/returns.controller";
import { AppScreensController } from "./screens/screens.controller";
import { AppStoresController } from "./stores/stores.controller";
import { AppSupportController } from "./support/support.controller";
import { AppWishlistController } from "./wishlist/wishlist.controller";

/** Customer app API (prefix /app via RouterModule): guests allowed where the controller says so. */
@Module({
    imports: [ApprovalsModule, CartModule, OrdersModule, SduiModule, StoresModule, SupportModule, UsersModule],
    controllers: [
        AppAddressesController,
        AppCartController,
        AppOrdersController,
        AppReturnsController,
        AppScreensController,
        AppStoresController,
        AppSupportController,
        AppWishlistController,
    ],
})
export class AppApiModule {}
