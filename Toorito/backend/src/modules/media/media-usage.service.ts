import { PrismaService } from "@core/database/prisma.service";
import { MEDIA_USAGE_TYPES, MediaUsageType } from "@modules/media/media.config";
import { collectKeys } from "@modules/media/media.utils";
import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma-client/client";

type Db = Prisma.TransactionClient;
/** SQL twins of detail() for library filters. Alias `m` = "MediaFile". Table/column names = Prisma defaults (adjust if @@map is used). */
const ex = (table: string, cond: string) =>
    `EXISTS (SELECT 1 FROM "${table}" x WHERE ${cond})`;
const VARIANTS = `CASE WHEN jsonb_typeof(m."variants") = 'object' THEN m."variants" ELSE '{}'::jsonb END`;
/**
 * App screen designer: `{ "mediaId": "123" }` anywhere inside a published version, a screen draft,
 * a saved section or a custom group's media. Drafts count too (deleting would break their next publish).
 */
const sduiHas = (col: string) =>
    `jsonb_path_exists(${col}, '$.**.mediaId ? (@ == $s || @ == $n)', jsonb_build_object('s', m.id::text, 'n', m.id))`;
const SDUI_USED_SQL = [
    ex("SduiScreenVersion", sduiHas(`x."layout"`)),
    ex("SduiScreen", `x."deletedAt" IS NULL AND ${sduiHas(`x."draftLayout"`)}`),
    ex("SduiSection", `x."deletedAt" IS NULL AND ${sduiHas(`x."node"`)}`),
    ex("SduiGroup", `x."deletedAt" IS NULL AND x."media" IS NOT NULL AND ${sduiHas(`x."media"`)}`),
].join(" OR ");
const USED_SQL: Record<MediaUsageType, string> = {
    product: `${ex("Product", `x."thumbnailId" = m.id`)} OR ${ex("ProductMedia", `x."mediaId" = m.id`)}`,
    category: ex("Category", `x."iconId" = m.id OR x."bannerId" = m.id`),
    brand: ex("Brand", `x."logoId" = m.id OR x."bannerId" = m.id`),
    store: ex("Store", `x."logoId" = m.id`),
    bundle: ex("Bundle", `x."thumbnailId" = m.id`),
    user: ex("User", `x."avatarId" = m.id`),
    kyc: ex("KycDocument", `x."frontMediaId" = m.id OR x."backMediaId" = m.id`),
    delivery: ex("Delivery", `x."proofMediaId" = m.id`),
    optionValue: ex("OptionValue", `x."imageId" = m.id`),
    support: ex(
        "SupportMessage",
        `x."attachmentIds" @> to_jsonb(m.id) OR x."attachmentIds" @> to_jsonb(m.id::text)`,
    ),
    goodsReceipt: ex("GoodsReceipt", `x."invoiceMediaIds" @> to_jsonb(m.id) OR x."invoiceMediaIds" @> to_jsonb(m.id::text)`),
    approval: ex("ApprovalRequest", `x."payload"->'mediaIds' @> to_jsonb(m.id) OR x."payload"->'mediaIds' @> to_jsonb(m.id::text)`),
    sdui: SDUI_USED_SQL,
    orderItem: ex(
        "OrderItem",
        `x."imageKey" = m."key" OR x."imageKey" IN (SELECT value FROM jsonb_each_text(${VARIANTS}))`,
    ),
};
const s = <T extends { id: bigint }>(x: T) => ({ ...x, id: x.id.toString() });

/** Every place a MediaFile can be referenced. Add new relations HERE only. */
@Injectable()
export class MediaUsageService {
    constructor(private readonly prisma: PrismaService) {}

    /** SQL predicate "m is referenced by any of `types`" (all types by default). */
    usedSql(types: readonly MediaUsageType[] = MEDIA_USAGE_TYPES) {
        return Prisma.raw(
            `(${types.map((t) => `(${USED_SQL[t]})`).join(" OR ")})`,
        );
    }

    /** OrderItem.imageKey is a storage-key SNAPSHOT (no FK): deleting those objects breaks order history. */
    async snapshotRefs(keys: string[], db: Db = this.prisma as unknown as Db) {
        if (!keys.length) return [];
        return db.orderItem.findMany({
            where: { imageKey: { in: keys } },
            select: { id: true, orderId: true },
            take: 20,
        });
    }

    async detail(id: bigint, db: Db = this.prisma as unknown as Db) {
        const media = await db.mediaFile.findUnique({
            where: { id },
            select: { key: true, variants: true },
        });
        const idNum = Number(id);
        const [
            products,
            categories,
            brands,
            stores,
            bundles,
            users,
            kyc,
            deliveries,
            productMedia,
            optionValues,
            messages,
            snapshots,
            receipts,
            approvals,
            sdui,
        ] = await Promise.all([
            db.product.findMany({
                where: { thumbnailId: id },
                select: { id: true, slug: true },
            }),
            db.category.findMany({
                where: { OR: [{ iconId: id }, { bannerId: id }] },
                select: { id: true, slug: true },
            }),
            db.brand.findMany({
                where: { OR: [{ logoId: id }, { bannerId: id }] },
                select: { id: true, slug: true },
            }),
            db.store.findMany({
                where: { logoId: id },
                select: { id: true, code: true, name: true },
            }),
            db.bundle.findMany({
                where: { thumbnailId: id },
                select: { id: true, slug: true },
            }),
            db.user.findMany({
                where: { avatarId: id },
                select: { id: true, phone: true },
            }),
            db.kycDocument.findMany({
                where: { OR: [{ frontMediaId: id }, { backMediaId: id }] },
                select: { id: true, userId: true, type: true },
            }),
            db.delivery.findMany({
                where: { proofMediaId: id },
                select: { id: true, orderId: true, partnerId: true },
            }),
            db.productMedia.findMany({
                where: { mediaId: id },
                select: {
                    productId: true,
                    variantId: true,
                    product: { select: { id: true, slug: true } },
                    variant: { select: { id: true, sku: true } },
                },
            }),
            db.optionValue.findMany({
                where: { imageId: id },
                select: { id: true, code: true },
            }),
            // SupportMessage.attachmentIds is a JSON array; ids may be stored as numbers or strings
            db.supportMessage.findMany({
                where: {
                    OR: [
                        { attachmentIds: { array_contains: idNum } },
                        { attachmentIds: { array_contains: id.toString() } },
                    ],
                },
                select: { id: true, ticketId: true },
                take: 20,
            }),
            media
                ? this.snapshotRefs(collectKeys(media), db)
                : Promise.resolve([]),
            // Supplier invoices of goods receipts / evidence photos of approval requests (JSON arrays).
            db.$queryRaw<{ id: bigint; storeId: bigint; grnNumber: string }[]>`
                SELECT id, "storeId", "grnNumber" FROM "GoodsReceipt"
                WHERE "invoiceMediaIds" @> ${JSON.stringify([idNum])}::jsonb OR "invoiceMediaIds" @> ${JSON.stringify([id.toString()])}::jsonb
                LIMIT 20`,
            db.$queryRaw<{ id: bigint; type: string; status: string }[]>`
                SELECT id, type::text, status::text FROM "ApprovalRequest"
                WHERE payload->'mediaIds' @> ${JSON.stringify([idNum])}::jsonb OR payload->'mediaIds' @> ${JSON.stringify([id.toString()])}::jsonb
                LIMIT 20`,
            this.sduiRefs(id, db),
        ]);

        const result = {
            mediaId: id.toString(),
            products: [
                ...products.map((x) => ({ ...s(x), relation: "thumbnail" })),
                ...productMedia
                    .filter((x) => !x.variantId)
                    .map((x) => ({
                        id: x.product.id.toString(),
                        slug: x.product.slug,
                        relation: "gallery",
                    })),
            ],
            variants: productMedia
                .filter((x) => !!x.variantId)
                .map((x) => ({
                    id: x.variant!.id.toString(),
                    sku: x.variant!.sku,
                    productId: x.productId.toString(),
                })),
            categories: categories.map(s),
            brands: brands.map(s),
            stores: stores.map(s),
            bundles: bundles.map(s),
            users: users.map(s),
            kyc: kyc.map((x) => ({ ...s(x), userId: x.userId.toString() })),
            deliveryProofs: deliveries.map((x) => ({
                ...s(x),
                orderId: x.orderId.toString(),
                partnerId: x.partnerId.toString(),
            })),
            optionValues: optionValues.map(s),
            supportMessages: messages.map((x) => ({
                ...s(x),
                ticketId: x.ticketId.toString(),
            })),
            goodsReceipts: receipts.map((x) => ({ id: x.id.toString(), storeId: x.storeId.toString(), grnNumber: x.grnNumber })),
            approvalRequests: approvals.map((x) => ({ id: x.id.toString(), type: x.type, status: x.status })),
            sdui, // screens / versions / saved sections / custom groups showing it, capped at 20
            orderItemSnapshots: snapshots.map((x) => ({
                ...s(x),
                orderId: x.orderId.toString(),
            })), // capped at 20
        };
        const total = Object.entries(result)
            .filter(([k]) => k !== "mediaId")
            .reduce((n, [, v]) => n + (Array.isArray(v) ? v.length : 0), 0);
        return { ...result, total };
    }

    /** Where the screen designer uses this media (see SDUI_USED_SQL). */
    private async sduiRefs(id: bigint, db: Db) {
        const path = "$.**.mediaId ? (@ == $s || @ == $n)";
        const vars = JSON.stringify({ s: id.toString(), n: Number(id) });
        const rows = await db.$queryRaw<
            { kind: string; id: bigint; key: string; version: number | null }[]
        >`
            SELECT 'version' AS kind, v.id, s.key, v.version FROM "SduiScreenVersion" v
              JOIN "SduiScreen" s ON s.id = v."screenId"
              WHERE jsonb_path_exists(v."layout", ${path}::jsonpath, ${vars}::jsonb)
            UNION ALL
            SELECT 'draft', s.id, s.key, NULL FROM "SduiScreen" s
              WHERE s."deletedAt" IS NULL AND jsonb_path_exists(s."draftLayout", ${path}::jsonpath, ${vars}::jsonb)
            UNION ALL
            SELECT 'section', x.id, x.key, NULL FROM "SduiSection" x
              WHERE x."deletedAt" IS NULL AND jsonb_path_exists(x."node", ${path}::jsonpath, ${vars}::jsonb)
            UNION ALL
            SELECT 'group', g.id, g.key, NULL FROM "SduiGroup" g
              WHERE g."deletedAt" IS NULL AND g."media" IS NOT NULL AND jsonb_path_exists(g."media", ${path}::jsonpath, ${vars}::jsonb)
            LIMIT 20`;
        return rows.map((r) => ({
            kind: r.kind,
            id: r.id.toString(),
            key: r.key,
            ...(r.version != null && { version: r.version }),
        }));
    }
}
