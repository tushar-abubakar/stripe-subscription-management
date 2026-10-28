/**
 * Writes the OpenAPI files (after `npm run build`):
 *   docs/openapi.json          all endpoints
 *   docs/openapi-app.json      customer app
 *   docs/openapi-admin.json    admin panel
 *   docs/openapi-store.json    store app
 *   docs/openapi-partner.json  delivery partner app
 * Import any of them into Postman / Insomnia, or feed them to an API client generator.
 *
 *   npm run docs:swagger
 */
const { NestFactory } = require("@nestjs/core");
const { writeFileSync, mkdirSync } = require("node:fs");
const path = require("node:path");

async function generate() {
    const { AppModule } = require("../dist/app.module");
    const { buildApiDocs } = require("../dist/api/swagger");

    const app = await NestFactory.create(AppModule, { logger: false });
    const prefix = (process.env.API_PREFIX || "api/v1").trim().replace(/^\/|\/$/g, "");
    app.setGlobalPrefix(prefix);

    const docs = buildApiDocs(app, "QuickCommerce API", "0.1.0");
    const dir = path.resolve("docs");
    mkdirSync(dir, { recursive: true });
    for (const [key, doc] of Object.entries(docs)) {
        const file = path.join(dir, key === "all" ? "openapi.json" : `openapi-${key}.json`);
        writeFileSync(file, JSON.stringify(doc, null, 2), "utf8");
        console.log(`${path.relative(process.cwd(), file)}: ${Object.keys(doc.paths).length} paths`);
    }
    await app.close();
}

generate()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
