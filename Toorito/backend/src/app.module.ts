import { AccountApiModule } from "@api/account/account-api.module";
import { AdminApiModule } from "@api/admin/admin-api.module";
import { AppApiModule } from "@api/app/app-api.module";
import { AuthApiModule } from "@api/auth/auth-api.module";
import { PartnerApiModule } from "@api/partner/partner-api.module";
import { PublicApiModule } from "@api/public/public-api.module";
import { StoreApiModule } from "@api/store/store-api.module";
import { AuthorizationModule } from "@common/authorization/authorization.module";
import { EventsModule } from "@common/events/events";
import { ValidatorsModule } from "@common/validators/validators.module";
import { AppConfig } from "@config/config.type";
import configuration from "@config/configuration";
import { AddressModule } from "@core/address/address.service";
import { AuditModule } from "@core/audit/audit.service";
import {
    JwtAuthGuard,
    HoldGuard,
    PermissionsGuard,
    RolesGuard,
} from "@core/auth/auth.guard";
import { CurrencyModule } from "@core/currency/currency.service";
import { PrismaModule } from "@core/database/prisma.module";
import { AllExceptionsFilter } from "@core/http/filters/http-exception.filter";
import { RequestIdMiddleware } from "@core/http/middleware/request-id.middleware";
import { LocaleModule } from "@core/locale/locale.module";
import { RedisModule } from "@core/redis/redis.module";
import { AdminModule } from "@modules/admin/admin.module";
import { AnalyticsModule } from "@modules/analytics/analytics.module";
import { ApprovalsModule } from "@modules/approvals/approvals.module";
import { AppConfigModule } from "@modules/app-config/app-config.module";
import { AuthModule } from "@modules/auth/auth.module";
import { CartModule } from "@modules/cart/cart.module";
import { BrandModule } from "@modules/catalog/brand/brand.module";
import { BundlesModule } from "@modules/catalog/bundles/bundles.module";
import { CategoryGroupModule } from "@modules/catalog/category-group/category-group.module";
import { CategoryModule } from "@modules/catalog/category/category.module";
import { OptionModule } from "@modules/catalog/option/option.module";
import { ProductModule } from "@modules/catalog/product/product.module";
import { SduiModule } from "@modules/sdui/sdui.module";
import { DeliveryModule } from "@modules/delivery/delivery.module";
import { KycModule } from "@modules/kyc/kyc.module";
import { InventoryModule } from "@modules/inventory/inventory.module";
import { MediaModule } from "@modules/media/media.module";
import { NotificationsModule } from "@modules/notifications/notifications.module";
import { OrdersModule } from "@modules/orders/orders.module";
import { PaymentsModule } from "@modules/payments/payments.module";
import { StoresModule } from "@modules/stores/stores.module";
import { SupportModule } from "@modules/support/support.module";
import { UsersModule } from "@modules/users/users.module";
import { MiddlewareConsumer, Module, NestModule } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { APP_FILTER, APP_GUARD, RouterModule } from "@nestjs/core";
import { ScheduleModule } from "@nestjs/schedule";
import { ServeStaticModule } from "@nestjs/serve-static";
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler";
import { mkdirSync } from "fs";
import {
    AcceptLanguageResolver,
    HeaderResolver,
    I18nModule,
} from "nestjs-i18n";
import * as path from "path";

/**
 * "https://api.example.com/media-public" -> "/media-public"
 * "https://media.example.com"            -> ""  (served by CDN/nginx, not Nest)
 */
const routeOf = (baseUrl: string): string => {
    try {
        return new URL(baseUrl).pathname.replace(/\/+$/, "");
    } catch {
        return "";
    }
};

@Module({
    imports: [
        // Global config
        ConfigModule.forRoot({
            isGlobal: true,
            load: [configuration],
            envFilePath: ".env",
        }),

        // Public media files (LOCAL provider only). Bypasses the global guards,
        // so only the public folder is ever exposed.
        ServeStaticModule.forRootAsync({
            inject: [ConfigService],
            useFactory: (config: ConfigService) => {
                const media = config.getOrThrow<AppConfig["media"]>("media");

                // Remote providers (S3/R2/...) are served by their CDN.
                if (media.provider !== "LOCAL") return [];

                // baseUrl without a path -> another domain serves the files.
                const serveRoot = routeOf(media.baseUrl);
                if (!serveRoot) return [];

                const base = path.isAbsolute(media.localDir)
                    ? media.localDir
                    : path.resolve(process.cwd(), media.localDir);
                const rootPath = path.join(base, media.publicDir);
                mkdirSync(rootPath, { recursive: true });

                return [
                    {
                        rootPath,
                        serveRoot,
                        serveStaticOptions: {
                            index: false,
                            setHeaders: (res) => {
                                res.setHeader(
                                    "Cross-Origin-Resource-Policy",
                                    "cross-origin",
                                );
                            },
                            ...(config.get("app.env") === "production"
                                ? { maxAge: "1y", immutable: true }
                                : {}),
                        },
                    },
                ];
            },
        }),

        // I18nModule with async configuration
        I18nModule.forRootAsync({
            useFactory: (config: ConfigService) => ({
                fallbackLanguage: config.getOrThrow<string>(
                    "i18n.defaultLanguage",
                ),
                loaderOptions: {
                    path: path.join(__dirname, "/i18n/"),
                    watch: config.get<string>("app.env") !== "production",
                },
            }),
            resolvers: [new HeaderResolver(["x-lang"]), AcceptLanguageResolver],
            inject: [ConfigService],
        }),

        ThrottlerModule.forRoot([{ ttl: 60000, limit: 100 }]),

        // Enables every @Cron job (scheduled listings, expiry sweep, unpaid-order expiry, cart cleanup...).
        ScheduleModule.forRoot(),

        PrismaModule,
        RedisModule,
        LocaleModule,
        CurrencyModule,
        AddressModule,
        ValidatorsModule,
        AuthorizationModule,
        EventsModule,
        AuditModule,
        AuthModule,
        AdminModule,
        AppConfigModule,
        UsersModule,
        KycModule,
        ApprovalsModule,
        StoresModule,
        MediaModule,
        //CatalogModule,
        CategoryModule,
        CategoryGroupModule,
        BrandModule,
        OptionModule,
        ProductModule,
        InventoryModule,
        BundlesModule,
        CartModule,
        OrdersModule,
        PaymentsModule,
        DeliveryModule,
        SupportModule,
        NotificationsModule,
        AnalyticsModule,
        SduiModule,

        // HTTP layer: one module per audience. URL = /<prefix>/<audience>/<controller path>.
        AdminApiModule,
        StoreApiModule,
        PartnerApiModule,
        AppApiModule,
        AccountApiModule,
        AuthApiModule,
        PublicApiModule,
        RouterModule.register([
            { path: "admin", module: AdminApiModule },
            { path: "store", module: StoreApiModule },
            { path: "partner", module: PartnerApiModule },
            { path: "app", module: AppApiModule },
            { path: "account", module: AccountApiModule },
            { path: "auth", module: AuthApiModule },
            { path: "public", module: PublicApiModule },
        ]),
    ],
    providers: [
        // 1. Rate limiting
        { provide: APP_GUARD, useClass: ThrottlerGuard },

        // 2. Authentication
        { provide: APP_GUARD, useClass: JwtAuthGuard },

        // 3. Role authorization
        { provide: APP_GUARD, useClass: RolesGuard },

        // 4. Permission authorization
        { provide: APP_GUARD, useClass: PermissionsGuard },

        // 5. Partial account holds (@Capability)
        { provide: APP_GUARD, useClass: HoldGuard },

        // 5. Global exception handling (translates every message)
        { provide: APP_FILTER, useClass: AllExceptionsFilter },
    ],
})
export class AppModule implements NestModule {
    configure(consumer: MiddlewareConsumer) {
        // Named wildcard (path-to-regexp v8): matches every route, including the root.
        consumer.apply(RequestIdMiddleware).forRoutes("{*path}");
    }
}

/*
HTTP Request
    │
    ▼
┌──────────────────────┐
│ 1. ThrottlerGuard   │  ← Rate limiting
└──────────┬───────────┘
           │ allowed
           ▼
┌──────────────────────┐
│ 2. JwtAuthGuard      │  ← JWT + session + account validity
└──────────┬───────────┘
           │ authenticated
           ▼
┌──────────────────────┐
│ 3. RolesGuard        │  ← ADMIN / MANAGER / STAFF / etc.
└──────────┬───────────┘
           │ role allowed
           ▼
┌──────────────────────┐
│ 4. PermissionsGuard  │  ← Fine-grained permission
└──────────┬───────────┘
           │ permission allowed
           ▼
       Controller
           │
           ▼
       Service
*/
