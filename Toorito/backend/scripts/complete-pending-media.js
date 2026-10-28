/**
 * Finishes uploads stuck in PENDING (the bytes are in storage but `complete` never succeeded),
 * acting as the user who uploaded each file. Run after `npm run build`:
 *
 *   node scripts/complete-pending-media.js 27 28
 */
const { NestFactory } = require("@nestjs/core");

async function main() {
    const ids = process.argv.slice(2).map((x) => BigInt(x));
    if (!ids.length) throw new Error("Usage: node scripts/complete-pending-media.js <mediaId> [...]");

    (BigInt.prototype).toJSON = function () {
        return this.toString();
    };
    const { AppModule } = require("../dist/app.module");
    const { MediaService } = require("../dist/modules/media/media.service");
    const { PrismaService } = require("../dist/core/database/prisma.service");

    const app = await NestFactory.create(AppModule, { logger: ["error", "warn"] });
    await app.init();
    const media = app.get(MediaService);
    const prisma = app.get(PrismaService);

    for (const id of ids) {
        try {
            const row = await prisma.mediaFile.findUnique({
                where: { id },
                select: { status: true, uploadedById: true, uploadedBy: { select: { role: true, storeId: true } } },
            });
            if (!row) {
                console.log(`#${id}: not found (already cleaned up?)`);
                continue;
            }
            const user = {
                id: row.uploadedById,
                role: row.uploadedBy?.role,
                storeId: row.uploadedBy?.storeId ?? null,
                sid: "script",
                jti: "script",
                exp: 0,
            };
            const res = await media.complete(id, user);
            console.log(`#${id}: ${row.status} -> ${res.status}${res.accessUrl ? "  " + res.accessUrl : ""}`);
        } catch (e) {
            console.log(`#${id}: FAILED  ${e?.response?.message ?? e?.message ?? e}`);
        }
    }
    await app.close();
}

main().then(
    () => process.exit(0),
    (e) => {
        console.error(e);
        process.exit(1);
    },
);
