import { validationExceptionFactory } from "@common/validators/validation-exception.factory";
import { AppConfig } from "@config/config.type";
import { Logger, ValidationPipe } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { NestFactory } from "@nestjs/core";
import { NestExpressApplication } from "@nestjs/platform-express";
import { useContainer } from "class-validator";
import helmet from "helmet";
import { resolve } from "path";
import { setupApiDocs } from "./api/swagger";
import { AppModule } from "./app.module";

async function bootstrap(): Promise<void> {
    const app = await NestFactory.create<NestExpressApplication>(AppModule, {
        // Needed to verify payment webhook signatures.
        rawBody: true,
        bufferLogs: false,
    });

    // Lets custom class-validator constraints use Nest dependency injection.
    useContainer(app.select(AppModule), { fallbackOnErrors: true });

    const config = app.get(ConfigService);
    const appConfig = config.getOrThrow<AppConfig["app"]>("app");
    const i18nConfig = config.getOrThrow<AppConfig["i18n"]>("i18n");
    const mediaConfig = config.getOrThrow<AppConfig["media"]>("media");

    app.use(helmet());

    // An empty CORS_ORIGINS allows every origin (development convenience).
    app.enableCors({
        origin: appConfig.corsOrigins.length > 0 ? appConfig.corsOrigins : true,
        credentials: true,
    });

    app.setGlobalPrefix(appConfig.prefix);

    app.useGlobalPipes(
        new ValidationPipe({
            whitelist: true,
            transform: true,
            forbidNonWhitelisted: true,
            transformOptions: { enableImplicitConversion: false },
            // Translates every constraint message through nestjs-i18n.
            exceptionFactory: validationExceptionFactory,
        }),
    );

    app.enableShutdownHooks();

    // Local media is served as static files; point MEDIA_PUBLIC_BASE_URL at a CDN in production.
    if (mediaConfig.provider === "LOCAL") {
        app.useStaticAssets(resolve(mediaConfig.localDir, "public"), {
            prefix: "/static",
            maxAge: "30d",
            immutable: true,
        });
    }

    if (appConfig.env !== "production") {
        // /docs (all) + /docs/app, /docs/admin, /docs/store, /docs/partner (one per client app).
        setupApiDocs(app, appConfig.name);
    }

    (BigInt.prototype as any).toJSON = function () {
        return this.toString();
    };

    await app.listen(appConfig.port);

    new Logger("Bootstrap").log(
        `API on :${appConfig.port}/${appConfig.prefix} ` +
            `languages=[${i18nConfig.languages.join(",")}] ` +
            `default=${i18nConfig.defaultLanguage}`,
    );
}

void bootstrap();
