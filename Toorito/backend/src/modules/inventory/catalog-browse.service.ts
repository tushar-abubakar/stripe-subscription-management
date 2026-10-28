import { isAdminRole } from "@common/authorization/permissions";
import { AuthUser } from "@common/types/auth.type";
import { CurrencyService } from "@core/currency/currency.service";
import { PrismaService } from "@core/database/prisma.service";
import { LocaleService } from "@core/locale/locale.service";
import { RedisService } from "@core/redis/redis.service";
import {
    ApprovalHandler,
    openApproval,
} from "@modules/approvals/approvals.repo";
import {
    MAX_GALLERY_ITEMS,
    MAX_VARIANT_MEDIA,
} from "@modules/catalog/product/product.types";
import {
    CatalogBrandInput,
    CatalogCategoryInput,
    CatalogChangeRequestInput,
} from "./inventory.types";
import { MediaService } from "@modules/media/media.service";
import { NotificationsService } from "@modules/notifications/notifications.service";
import {
    BadRequestException,
    Injectable,
    NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma-client/client";
import {
    ApprovalRequestStatus,
    ApprovalType,
    BrandStatus,
    CategoryStatus,
    MediaPurpose,
    MediaStatus,
    MediaType,
    ProductStatus,
    UserRole,
} from "@prisma-client/enums";
import { I18nService } from "nestjs-i18n";

/** Category tree node as cached (ids as strings: Redis JSON has no bigint). */
interface CatNode {
    id: string;
    parentId: string | null;
    slug: string;
    name: Record<string, string>;
    depth: number;
    position: number;
    updatedAt: string;
    iconUrl: string | null;
}
interface CountRow {
    key: string;
    total: number;
    /** At least one variation listed in this store. */
    listed: number;
    /** At least one active variation not listed yet. */
    toAdd: number;
}

const MEDIA_SELECT = {
    id: true,
    type: true,
    mimeType: true,
    width: true,
    height: true,
    key: true,
    isPrivate: true,
    variants: true,
    status: true,
    title: true,
    alt: true,
} satisfies Prisma.MediaFileSelect;
type MediaRow = Prisma.MediaFileGetPayload<{ select: typeof MEDIA_SELECT }>;

const TREE_KEY = "catalog:cat-tree";
const TREE_TTL = 120;
const COUNTS_TTL = 60;

/**
 * "Add from catalog" for store managers: category / brand facets (only
 * non-empty ones, with this store's listed / unlisted counts), the product's
 * gallery and variation media, and change requests to the admin.
 *
 * Counts are one GROUP BY over published products, cached 60 s per store
 * + filter; the category tree is cached 120 s for everyone.
 */
@Injectable()
export class CatalogBrowseService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly redis: RedisService,
        private readonly locale: LocaleService,
        private readonly media: MediaService,
        private readonly currency: CurrencyService,
        private readonly notify: NotificationsService,
        private readonly i18n: I18nService,
    ) {}

    private t(key: string, args?: Record<string, unknown>) {
        return this.i18n.translate(
            `inventory.${key}`,
            args ? { args } : {},
        ) as string;
    }

    // ---------------------------------------------------------------------
    // Category tree + descendants
    // ---------------------------------------------------------------------

    private tree(): Promise<CatNode[]> {
        return this.redis.cachedLease(TREE_KEY, TREE_TTL, async () => {
            const rows = await this.prisma.category.findMany({
                where: { status: CategoryStatus.ACTIVE },
                select: {
                    id: true,
                    parentId: true,
                    slug: true,
                    name: true,
                    depth: true,
                    position: true,
                    updatedAt: true,
                    icon: {
                        select: {
                            key: true,
                            isPrivate: true,
                            variants: true,
                            status: true,
                        },
                    },
                },
            });
            return rows.map((c) => ({
                id: c.id.toString(),
                parentId: c.parentId?.toString() ?? null,
                slug: c.slug,
                name: (c.name ?? {}) as Record<string, string>,
                depth: c.depth,
                position: c.position,
                updatedAt: c.updatedAt.toISOString(),
                iconUrl:
                    c.icon && c.icon.status === MediaStatus.READY
                        ? this.media.urlForVariant(c.icon, "thumb")
                        : null,
            }));
        });
    }

    /** The categories plus all their sub-categories. */
    async withDescendants(ids: (number | bigint)[]): Promise<bigint[]> {
        if (!ids.length) return [];
        const nodes = await this.tree();
        const children = new Map<string, string[]>();
        for (const n of nodes)
            if (n.parentId)
                children.set(n.parentId, [
                    ...(children.get(n.parentId) ?? []),
                    n.id,
                ]);
        const out = new Set<string>();
        const stack = ids.map(String);
        while (stack.length) {
            const id = stack.pop()!;
            if (out.has(id)) continue;
            out.add(id);
            stack.push(...(children.get(id) ?? []));
        }
        return [...out].map(BigInt);
    }

    // ---------------------------------------------------------------------
    // Counts (published products; listed = at least one variation listed in this store)
    // ---------------------------------------------------------------------

    private counts(
        storeId: bigint,
        by: "category" | "brand",
        filterIds: bigint[],
    ): Promise<CountRow[]> {
        const col =
            by === "category"
                ? Prisma.sql`p."categoryId"`
                : Prisma.sql`p."brandId"`;
        const filterCol =
            by === "category"
                ? Prisma.sql`p."brandId"`
                : Prisma.sql`p."categoryId"`;
        const key = `catalog:counts:v2:${storeId}:${by}:${filterIds.map(String).sort().join(",")}`;
        return this.redis.cachedLease(
            key,
            COUNTS_TTL,
            () =>
                this.prisma.$queryRaw<CountRow[]>`
                SELECT ${col}::text AS key,
                       COUNT(*)::int AS total,
                       COUNT(*) FILTER (WHERE EXISTS (
                           SELECT 1 FROM "StoreProduct" sp WHERE sp."productId" = p.id AND sp."storeId" = ${storeId}
                       ))::int AS listed,
                       COUNT(*) FILTER (WHERE EXISTS (
                           SELECT 1 FROM "ProductVariant" v
                           WHERE v."productId" = p.id AND v."deletedAt" IS NULL AND v."isActive"
                             AND NOT EXISTS (SELECT 1 FROM "StoreProduct" sp WHERE sp."variantId" = v.id AND sp."storeId" = ${storeId})
                       ))::int AS "toAdd"
                FROM "Product" p
                WHERE p.status = 'PUBLISHED'::"ProductStatus" AND p."deletedAt" IS NULL AND ${col} IS NOT NULL
                  ${filterIds.length ? Prisma.sql`AND ${filterCol} IN (${Prisma.join(filterIds)})` : Prisma.empty}
                GROUP BY 1`,
        );
    }

    private matches(
        q: string | undefined,
        name: Record<string, string>,
        slug: string,
    ) {
        if (!q) return true;
        const needle = q.trim().toLowerCase().normalize("NFKC");
        return [slug, ...Object.values(name ?? {})].some((v) =>
            String(v).toLowerCase().normalize("NFKC").includes(needle),
        );
    }

    private keep(
        listed: CatalogCategoryInput["listed"],
        c: { total: number; listed: number; toAdd: number },
    ) {
        if (c.total <= 0) return false; // skip empty
        if (listed === "listed") return c.listed > 0;
        if (listed === "unlisted") return c.total - c.listed > 0;
        if (listed === "to_add") return c.toAdd > 0;
        return true;
    }

    // ---------------------------------------------------------------------
    // Category facet
    // ---------------------------------------------------------------------

    async categories(storeId: bigint, q: CatalogCategoryInput, lang?: string) {
        const [nodes, rows] = await Promise.all([
            this.tree(),
            this.counts(storeId, "category", (q.brandIds ?? []).map(BigInt)),
        ]);
        const byId = new Map(nodes.map((n) => [n.id, n]));
        const direct = new Map(rows.map((r) => [r.key, r]));

        // Subtree counts: deepest first, add each node to its parent.
        const sum = new Map(
            nodes.map((n) => [
                n.id,
                {
                    total: direct.get(n.id)?.total ?? 0,
                    listed: direct.get(n.id)?.listed ?? 0,
                    toAdd: direct.get(n.id)?.toAdd ?? 0,
                },
            ]),
        );
        for (const n of [...nodes].sort((a, b) => b.depth - a.depth)) {
            if (!n.parentId || !sum.has(n.parentId)) continue;
            const p = sum.get(n.parentId)!;
            const c = sum.get(n.id)!;
            p.total += c.total;
            p.listed += c.listed;
            p.toAdd += c.toAdd;
        }
        const visible = nodes.filter((n) =>
            this.keep(q.listed, sum.get(n.id)!),
        );
        const visibleIds = new Set(visible.map((n) => n.id));
        const kids = new Map<string, CatNode[]>();
        for (const n of visible)
            if (n.parentId && visibleIds.has(n.parentId))
                kids.set(n.parentId, [...(kids.get(n.parentId) ?? []), n]);

        const path = (n: CatNode) => {
            const out: { id: string; name: string }[] = [];
            let cur = n.parentId ? byId.get(n.parentId) : undefined;
            while (cur) {
                out.unshift({
                    id: cur.id,
                    name: this.locale.pick(cur.name, lang),
                });
                cur = cur.parentId ? byId.get(cur.parentId) : undefined;
            }
            return out;
        };
        const present = (n: CatNode) => {
            const c = sum.get(n.id)!;
            return {
                id: n.id,
                slug: n.slug,
                name: this.locale.pick(n.name, lang),
                parentId: n.parentId,
                depth: n.depth,
                position: n.position,
                iconUrl: n.iconUrl,
                productCount: c.total,
                listedCount: c.listed,
                unlistedCount: c.total - c.listed,
                toAddCount: c.toAdd,
                childCount: kids.get(n.id)?.length ?? 0,
                updatedAt: n.updatedAt,
            };
        };
        const sorter =
            (sort: CatalogCategoryInput["sort"]) =>
            (a: CatNode, b: CatNode) => {
                const ca = sum.get(a.id)!;
                const cb = sum.get(b.id)!;
                const name = (n: CatNode) =>
                    this.locale.pick(n.name, lang).toLowerCase();
                switch (sort) {
                    case "name_asc":
                        return name(a).localeCompare(name(b));
                    case "name_desc":
                        return name(b).localeCompare(name(a));
                    case "products_desc":
                        return (
                            cb.total - ca.total ||
                            name(a).localeCompare(name(b))
                        );
                    case "unlisted_desc":
                        return (
                            cb.total - cb.listed - (ca.total - ca.listed) ||
                            name(a).localeCompare(name(b))
                        );
                    case "updated_desc":
                        return b.updatedAt.localeCompare(a.updatedAt);
                    default:
                        return (
                            a.position - b.position ||
                            Number(a.id) - Number(b.id)
                        );
                }
            };

        // Tree: nested children from the roots (or from `parentId`), no paging.
        if (q.view === "tree") {
            const build = (n: CatNode): unknown => ({
                ...present(n),
                children: (kids.get(n.id) ?? [])
                    .sort(sorter(q.sort))
                    .map(build),
            });
            const roots = visible
                .filter((n) =>
                    q.parentId
                        ? n.parentId === String(q.parentId)
                        : !n.parentId || !visibleIds.has(n.parentId),
                )
                .filter((n) => !q.q || this.subtreeMatches(n, kids, q.q))
                .sort(sorter(q.sort));
            return { items: roots.map(build), total: roots.length };
        }

        // Flat: one level (`parentId`) or every level; search shows the path for context.
        let list = visible;
        if (q.parentId !== undefined)
            list = list.filter((n) =>
                q.parentId === 0
                    ? !n.parentId
                    : n.parentId === String(q.parentId),
            );
        if (q.q) list = list.filter((n) => this.matches(q.q, n.name, n.slug));
        list = [...list].sort(sorter(q.sort));
        const limit = Math.min(Math.max(Number(q.limit ?? 50), 1), 200);
        const page = Math.max(Number(q.page ?? 1), 1);
        return {
            items: list
                .slice((page - 1) * limit, page * limit)
                .map((n) => ({ ...present(n), path: path(n) })),
            total: list.length,
            page,
            limit,
        };
    }

    private subtreeMatches(
        n: CatNode,
        kids: Map<string, CatNode[]>,
        q: string,
    ): boolean {
        return (
            this.matches(q, n.name, n.slug) ||
            (kids.get(n.id) ?? []).some((k) => this.subtreeMatches(k, kids, q))
        );
    }

    // ---------------------------------------------------------------------
    // Brand facet
    // ---------------------------------------------------------------------

    async brands(storeId: bigint, q: CatalogBrandInput, lang?: string) {
        const categoryIds = await this.withDescendants(q.categoryIds ?? []);
        const rows = await this.counts(storeId, "brand", categoryIds);
        const count = new Map(rows.map((r) => [r.key, r]));
        const brands = await this.prisma.brand.findMany({
            where: {
                id: { in: rows.map((r) => BigInt(r.key)) },
                status: BrandStatus.ACTIVE,
            },
            select: {
                id: true,
                slug: true,
                name: true,
                updatedAt: true,
                logo: {
                    select: {
                        key: true,
                        isPrivate: true,
                        variants: true,
                        status: true,
                    },
                },
            },
        });
        const name = (b: (typeof brands)[number]) =>
            this.locale.pick(b.name, lang);
        let list = brands
            .map((b) => ({ b, c: count.get(b.id.toString())! }))
            .filter(({ c }) => this.keep(q.listed, c))
            .filter(({ b }) =>
                this.matches(
                    q.q,
                    (b.name ?? {}) as Record<string, string>,
                    b.slug,
                ),
            );
        const byName = (
            x: { b: (typeof brands)[number] },
            y: { b: (typeof brands)[number] },
        ) => name(x.b).toLowerCase().localeCompare(name(y.b).toLowerCase());
        list = list.sort((x, y) => {
            switch (q.sort) {
                case "name_desc":
                    return byName(y, x);
                case "products_desc":
                    return y.c.total - x.c.total || byName(x, y);
                case "unlisted_desc":
                    return (
                        y.c.total - y.c.listed - (x.c.total - x.c.listed) ||
                        byName(x, y)
                    );
                case "updated_desc":
                    return y.b.updatedAt.getTime() - x.b.updatedAt.getTime();
                default:
                    return byName(x, y);
            }
        });
        const limit = Math.min(Math.max(Number(q.limit ?? 50), 1), 200);
        const page = Math.max(Number(q.page ?? 1), 1);
        return {
            items: list
                .slice((page - 1) * limit, page * limit)
                .map(({ b, c }) => ({
                    id: b.id.toString(),
                    slug: b.slug,
                    name: name(b),
                    logoUrl:
                        b.logo && b.logo.status === MediaStatus.READY
                            ? this.media.urlForVariant(b.logo, "thumb")
                            : null,
                    productCount: c.total,
                    listedCount: c.listed,
                    unlistedCount: c.total - c.listed,
                    toAddCount: c.toAdd,
                    updatedAt: b.updatedAt,
                })),
            total: list.length,
            page,
            limit,
        };
    }

    // ---------------------------------------------------------------------
    // Gallery (product + variations): images, videos, audio
    // ---------------------------------------------------------------------

    private presentMedia(m: MediaRow, position?: number) {
        const ready = m.status === MediaStatus.READY;
        return {
            id: m.id.toString(),
            type: m.type,
            mimeType: m.mimeType,
            width: m.width,
            height: m.height,
            position,
            title: m.title ? this.locale.pick(m.title) : null,
            alt: m.alt ? this.locale.pick(m.alt) : null,
            thumbUrl:
                ready && m.type === MediaType.IMAGE
                    ? this.media.urlForVariant(m, "thumb")
                    : null,
            url: ready ? this.media.urlForVariant(m, "master") : null,
        };
    }

    /** Product gallery and each variation's own media, in display order. */
    async gallery(productId: bigint) {
        const rows = await this.prisma.productMedia.findMany({
            where: { productId, media: { deletedAt: null } },
            orderBy: [{ position: "asc" }, { id: "asc" }],
            select: {
                variantId: true,
                position: true,
                media: { select: MEDIA_SELECT },
            },
        });
        const product = rows
            .filter((r) => !r.variantId)
            .map((r) => this.presentMedia(r.media, r.position));
        const byVariant = new Map<
            string,
            ReturnType<CatalogBrowseService["presentMedia"]>[]
        >();
        for (const r of rows.filter((x) => x.variantId)) {
            const k = r.variantId!.toString();
            byVariant.set(k, [
                ...(byVariant.get(k) ?? []),
                this.presentMedia(r.media, r.position),
            ]);
        }
        return { product, byVariant };
    }

    // ---------------------------------------------------------------------
    // Change requests (store → admin)
    // ---------------------------------------------------------------------

    async requestChange(
        storeId: bigint | null,
        productId: bigint,
        dto: CatalogChangeRequestInput,
        actor: AuthUser,
    ) {
        const product = await this.prisma.product.findFirst({
            where: {
                id: productId,
                deletedAt: null,
                status: ProductStatus.PUBLISHED,
            },
            select: {
                id: true,
                slug: true,
                translations: { select: { lang: true, title: true } },
                variants: {
                    where: { deletedAt: null },
                    select: { id: true, sku: true, mrp: true },
                },
            },
        });
        if (!product)
            throw new NotFoundException(this.t("errors.productNotAvailable"));
        const variant = dto.variantId
            ? product.variants.find((v) => v.id === BigInt(dto.variantId!))
            : undefined;
        if (dto.variantId && !variant)
            throw new BadRequestException({
                message: this.t("errors.variantNotInProduct"),
                code: "VARIANT_NOT_IN_PRODUCT",
            });

        const mediaIds = dto.mediaIds ?? [];
        if (mediaIds.length) {
            const ok = await this.prisma.mediaFile.count({
                where: {
                    id: { in: mediaIds.map((m) => BigInt(m)) },
                    uploadedById: actor.id,
                    purpose: MediaPurpose.PRODUCT,
                    status: MediaStatus.READY,
                    deletedAt: null,
                },
            });
            if (ok !== mediaIds.length)
                throw new BadRequestException({
                    message: this.t("errors.changeMediaInvalid"),
                    code: "CHANGE_MEDIA_INVALID",
                });
        }

        const { product: gallery } = await this.gallery(product.id);
        const request = await this.prisma.$transaction((tx) =>
            openApproval(tx, actor, {
                type: ApprovalType.CATALOG_CHANGE,
                storeId,
                targetType: variant ? "ProductVariant" : "Product",
                targetId: variant ? variant.id : product.id,
                note: dto.note,
                payload: {
                    productId: product.id,
                    variantId: variant?.id ?? null,
                    fields: dto.fields,
                    mediaIds,
                },
                snapshot: {
                    slug: product.slug,
                    title: Object.fromEntries(
                        product.translations.map((t) => [t.lang, t.title]),
                    ),
                    sku: variant?.sku ?? null,
                    mrp: variant ? Number(variant.mrp) : null,
                    galleryIds: gallery.map((g) => g.id),
                },
            }),
        );

        const admins = await this.prisma.user.findMany({
            where: {
                role: { in: [UserRole.ADMIN, UserRole.SUPER_ADMIN] },
                deletedAt: null,
                status: "ACTIVE",
            },
            select: { id: true },
            take: 50,
        });
        await Promise.all(
            admins.map((a) =>
                this.notify.notify(
                    a.id,
                    "APPROVAL",
                    this.t("notification.catalogChange"),
                    `${product.slug}: ${dto.fields.join(", ")}`,
                    {
                        approvalId: request.id.toString(),
                    },
                ),
            ),
        );
        return {
            success: true,
            approvalId: request.id,
            status: request.status,
        };
    }

    /** This store's requests for a product: pending + decided in the last 30 days. */
    async requestsFor(storeId: bigint | null, productId: bigint) {
        const since = new Date(Date.now() - 30 * 86400000);
        const rows = await this.prisma.approvalRequest.findMany({
            where: {
                type: ApprovalType.CATALOG_CHANGE,
                storeId,
                payload: { path: ["productId"], equals: productId.toString() },
                OR: [
                    { status: ApprovalRequestStatus.PENDING },
                    { reviewedAt: { gte: since } },
                ],
            },
            orderBy: { id: "desc" },
            take: 20,
            select: {
                id: true,
                status: true,
                payload: true,
                note: true,
                reviewNote: true,
                createdAt: true,
                reviewedAt: true,
            },
        });
        return rows.map(({ payload, ...r }) => {
            const p = payload as {
                variantId?: string | null;
                fields?: string[];
                mediaIds?: number[];
            };
            return {
                ...r,
                variantId: p.variantId ?? null,
                fields: p.fields ?? [],
                mediaIds: p.mediaIds ?? [],
            };
        });
    }

    /** What the admin sees in the approval detail. */
    async changeTarget(r: { payload: unknown }) {
        const p = r.payload as {
            productId: string;
            variantId?: string | null;
            mediaIds?: number[];
        };
        const product = await this.prisma.product.findUnique({
            where: { id: BigInt(p.productId) },
            select: {
                id: true,
                slug: true,
                status: true,
                updatedAt: true,
                translations: { select: { lang: true, title: true } },
                brand: { select: { id: true, name: true } },
                category: { select: { id: true, name: true } },
                variants: {
                    where: { deletedAt: null },
                    select: { id: true, sku: true, mrp: true, isActive: true },
                },
            },
        });
        if (!product) return null;
        const [{ product: gallery, byVariant }, suggested] = await Promise.all([
            this.gallery(product.id),
            this.prisma.mediaFile.findMany({
                where: { id: { in: (p.mediaIds ?? []).map((m) => BigInt(m)) } },
                select: MEDIA_SELECT,
            }),
        ]);
        return {
            id: product.id,
            slug: product.slug,
            status: product.status,
            updatedAt: product.updatedAt,
            title: this.locale.pick(
                Object.fromEntries(
                    product.translations.map((t) => [t.lang, t.title]),
                ),
            ),
            brand: product.brand && {
                id: product.brand.id,
                name: this.locale.pick(product.brand.name),
            },
            category: product.category && {
                id: product.category.id,
                name: this.locale.pick(product.category.name),
            },
            gallery,
            variants: product.variants.map((v) => ({
                id: v.id,
                sku: v.sku,
                mrp: this.currency.format(v.mrp),
                isActive: v.isActive,
                media: byVariant.get(v.id.toString()) ?? [],
                requested: p.variantId === v.id.toString(),
            })),
            suggestedMedia: suggested.map((m) => this.presentMedia(m)),
        };
    }

    handlers(): Partial<Record<ApprovalType, ApprovalHandler>> {
        return {
            [ApprovalType.CATALOG_CHANGE]: async (
                tx,
                req,
                { approve, actor, options },
            ) => {
                if (!approve) return { result: {} };
                const p = req.payload as {
                    productId: string;
                    variantId?: string | null;
                    mediaIds?: number[];
                };
                if (
                    !options?.applyMedia ||
                    !p.mediaIds?.length ||
                    !isAdminRole(actor.role)
                )
                    // The admin made the change in the catalogue editor; approving records it as done.
                    return { result: { applied: [], mediaApplied: false } };

                // Attach the store's suggested images / videos to the gallery (or the variation).
                const productId = BigInt(p.productId);
                const variantId = p.variantId ? BigInt(p.variantId) : null;
                const files = await tx.mediaFile.findMany({
                    where: {
                        id: { in: p.mediaIds.map((m) => BigInt(m)) },
                        deletedAt: null,
                        status: MediaStatus.READY,
                    },
                    select: { id: true, type: true },
                });
                const existing = await tx.productMedia.findMany({
                    where: variantId
                        ? { variantId }
                        : { productId, variantId: null },
                    select: { mediaId: true, position: true },
                });
                const attached = new Set(
                    existing.map((e) => e.mediaId.toString()),
                );
                const max = variantId ? MAX_VARIANT_MEDIA : MAX_GALLERY_ITEMS;
                let position =
                    existing.reduce((m, e) => Math.max(m, e.position), -1) + 1;
                const applied: string[] = [];
                const skipped: { id: string; reason: string }[] = [];
                for (const f of files) {
                    const id = f.id.toString();
                    if (attached.has(id))
                        skipped.push({ id, reason: "ALREADY_ATTACHED" });
                    else if (
                        f.type !== MediaType.IMAGE &&
                        f.type !== MediaType.VIDEO
                    )
                        skipped.push({ id, reason: "NOT_IMAGE_OR_VIDEO" });
                    else if (existing.length + applied.length >= max)
                        skipped.push({ id, reason: "LIMIT_REACHED" });
                    else {
                        await tx.productMedia.create({
                            data: {
                                productId,
                                variantId,
                                mediaId: f.id,
                                position: position++,
                            },
                        });
                        applied.push(id);
                    }
                }
                if (applied.length) {
                    const product = await tx.product.findUniqueOrThrow({
                        where: { id: productId },
                        select: { thumbnailId: true },
                    });
                    const firstImage = files.find(
                        (f) =>
                            applied.includes(f.id.toString()) &&
                            f.type === MediaType.IMAGE,
                    );
                    await tx.product.update({
                        where: { id: productId },
                        data: {
                            updatedAt: new Date(),
                            ...(!product.thumbnailId &&
                                !variantId &&
                                firstImage && { thumbnailId: firstImage.id }),
                        },
                    });
                }
                return { result: { applied, skipped, mediaApplied: true } };
            },
        };
    }
}
