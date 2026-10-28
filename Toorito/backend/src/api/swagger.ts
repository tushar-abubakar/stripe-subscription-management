import { INestApplication } from "@nestjs/common";
import {
    DocumentBuilder,
    OpenAPIObject,
    SwaggerModule,
} from "@nestjs/swagger";
import { AccountApiModule } from "./account/account-api.module";
import { AdminApiModule } from "./admin/admin-api.module";
import { AppApiModule } from "./app/app-api.module";
import { AuthApiModule } from "./auth/auth-api.module";
import { PartnerApiModule } from "./partner/partner-api.module";
import { PublicApiModule } from "./public/public-api.module";
import { StoreApiModule } from "./store/store-api.module";

/**
 * One Swagger document per client app, so each team sees only its own endpoints
 * (with their inputs, sample requests and sample responses):
 *
 *   /docs          everything
 *   /docs/app      customer app      (/app, /public, /account, /auth)
 *   /docs/admin    admin panel       (/admin, /account, /auth)
 *   /docs/store    store app         (/store, /account, /auth)
 *   /docs/partner  delivery partner  (/partner, /account, /auth)
 *
 * Each page also serves its JSON at `<path>-json` (e.g. /docs/app-json) for Postman / Insomnia / codegen.
 */
export const API_DOCS = [
    {
        key: "app",
        title: "Customer app API",
        description:
            "Everything the customer app calls: customer features (/app), open catalogue and config (/public), the signed-in user's own data (/account) and login (/auth). Guests can call the endpoints without a lock icon.",
        modules: [AppApiModule, PublicApiModule, AccountApiModule, AuthApiModule],
        /** Server-to-server endpoints the app never calls. */
        hide: [/\/public\/webhooks\//, /\/public\/health$/],
    },
    {
        key: "admin",
        title: "Admin panel API",
        description: "Admin panel (/admin), the admin's own account (/account) and login (/auth).",
        modules: [AdminApiModule, AccountApiModule, AuthApiModule],
    },
    {
        key: "store",
        title: "Store app API",
        description: "Store manager / staff app (/store), own account (/account) and login (/auth).",
        modules: [StoreApiModule, AccountApiModule, AuthApiModule],
    },
    {
        key: "partner",
        title: "Delivery partner app API",
        description: "Delivery partner app (/partner), own account (/account) and login (/auth).",
        modules: [PartnerApiModule, AccountApiModule, AuthApiModule],
    },
] as const;

const builder = (title: string, description: string, version: string) =>
    new DocumentBuilder()
        .setTitle(title)
        .setDescription(description)
        .setVersion(version)
        .addServer("/", "Current API server")
        .addBearerAuth(
            { type: "http", scheme: "bearer", bearerFormat: "JWT" },
            "access-token",
        )
        .build();

/** The full document plus one per client app, keyed "all" / "app" / "admin" / "store" / "partner". */
export function buildApiDocs(
    app: INestApplication,
    name: string,
    version = "1.0",
): Record<string, OpenAPIObject> {
    const docs: Record<string, OpenAPIObject> = {
        all: SwaggerModule.createDocument(
            app,
            builder(name, "All endpoints", version),
        ),
    };
    for (const d of API_DOCS) {
        const doc = SwaggerModule.createDocument(
            app,
            builder(`${name} · ${d.title}`, d.description, version),
            { include: [...d.modules] },
        );
        const hide: readonly RegExp[] = "hide" in d ? d.hide : [];
        for (const p of Object.keys(doc.paths))
            if (hide.some((re) => re.test(p))) delete doc.paths[p];
        docs[d.key] = doc;
    }
    return docs;
}

/** Serves /docs (all) and /docs/<app> pages, each with its `-json`. */
export function setupApiDocs(app: INestApplication, name: string) {
    const docs = buildApiDocs(app, name);
    const options = { swaggerOptions: { persistAuthorization: true, displayRequestDuration: true } };
    // Per-app pages first so "/docs" doesn't swallow "/docs/<app>".
    for (const d of API_DOCS)
        SwaggerModule.setup(`docs/${d.key}`, app, docs[d.key], {
            ...options,
            customSiteTitle: `${name} · ${d.title}`,
        });
    SwaggerModule.setup("docs", app, docs.all, {
        ...options,
        explorer: true,
        swaggerOptions: {
            ...options.swaggerOptions,
            urls: [
                { url: "/docs-json", name: "All endpoints" },
                ...API_DOCS.map((d) => ({ url: `/docs/${d.key}-json`, name: d.title })),
            ],
        },
    });
}
