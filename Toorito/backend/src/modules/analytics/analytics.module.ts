import { AnalyticsService } from "./analytics.service";
import { Module } from "@nestjs/common";

/**
 * Sales reports & exploratory analytics (read-only, raw SQL over orders).
 *
 * - `StoreAnalyticsController` — store manager, own store.
 * - `AdminAnalyticsController` — admin: store leaderboard + any store's reports.
 */
@Module({
    providers: [AnalyticsService],
    exports: [AnalyticsService],
})
export class AnalyticsModule {}
