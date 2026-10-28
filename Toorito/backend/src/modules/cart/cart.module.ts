import { CartService } from "./cart.service";
import { PricingService } from "./pricing.service";
import { Module } from "@nestjs/common";

@Module({
    providers: [CartService, PricingService],
    exports: [CartService, PricingService],
})
export class CartModule {}
