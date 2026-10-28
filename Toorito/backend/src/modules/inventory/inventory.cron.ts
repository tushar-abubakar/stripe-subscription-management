import { Injectable } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { ListingService } from "./listing.service";
import { StockService } from "./stock.service";

/** Inventory cron jobs (thin: each calls one service method, which takes its own Redis lock). */
@Injectable()
export class InventoryCron {
    constructor(
        private readonly listing: ListingService,
        private readonly stock: StockService,
    ) {}

    /** SCHEDULED → ACTIVE once `publishAt` has passed. */
    @Cron(CronExpression.EVERY_MINUTE)
    publishScheduled() {
        return this.listing.publishScheduled();
    }

    /** Past-expiry batches → EXPIRED, stock removed from the store balance. */
    @Cron(CronExpression.EVERY_30_MINUTES)
    expirySweep() {
        return this.stock.expirySweep();
    }
}
