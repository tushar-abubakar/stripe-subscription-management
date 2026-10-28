import {
    pageParams,
    randomToken,
    toBigInt,
    toUrlSlug,
} from "@common/utils/helpers.util";
import {
    richTextMapToPlain,
    sanitizeRichTextMap,
} from "@common/utils/richText.util";
import { PrismaService } from "@core/database/prisma.service";
import { LocaleService } from "@core/locale/locale.service";
import {
    CategoryBulkStatusInput,
    CategoryInput,
    CategoryListInput,
    CategorySort,
    CategoryStatusInput,
    CheckCategorySlugInput,
} from "./category.types";
import { CatalogCacheService } from "../shared/catalog-cache.service";
import { CatalogMediaValidator } from "../shared/catalog-media.validator";
import { throwUniqueConflict } from "../shared/catalog.util";
import { MediaService } from "@modules/media/media.service";
import {
    BadRequestException,
    ConflictException,
    Injectable,
    NotFoundException,
} from "@nestjs/common";
import { MediaPurpose, Prisma } from "@prisma-client/client";
import { CategoryStatus } from "@prisma-client/enums";
import { I18nContext, I18nService } from "nestjs-i18n";

/** Why a category cannot change status (returned in 409 / dry-run). */
export interface CategoryStatusBlocker {
    /** Blocked category; null for batch-wide rules (minimumRequired). */
    id: string | null;
    code: "inUse" | "hasChildren" | "parentNotActive" | "minimumRequired";
    /** Translated, ready to show. */
    message: string;
    productCount?: number;
    listingCount?: number;
    /** Children outside the selection (hasChildren). */
    childIds?: string[];
    /** Non-active parent (parentNotActive). */
    parentId?: string;
}

interface CategoryUsage {
    products: number;
    listings: number;
}

const SERIALIZABLE = {
    isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
} as const;

export const IMAGE_SELECT = {
    id: true,
    key: true,
    isPrivate: true,
} as const;

/** Max characters of the plain-text `shortDescription` (per language). */
export const CATEGORY_SHORT_DESCRIPTION_LENGTH = 160;

/** Maps the public `sort` value to a Prisma `orderBy` for categories. */
const CATEGORY_ORDER_BY: Record<
    CategorySort,
    Prisma.CategoryOrderByWithRelationInput
> = {
    position_asc: { position: "asc" },
    position_desc: { position: "desc" },
    id_asc: { id: "asc" },
    id_desc: { id: "desc" },
    slug_asc: { slug: "asc" },
    slug_desc: { slug: "desc" },
    depth_asc: { depth: "asc" },
    depth_desc: { depth: "desc" },
    updated_asc: { updatedAt: "asc" },
    updated_desc: { updatedAt: "desc" },
};

/**
 * Category domain service (admin CRUD + public storefront reads).
 *
 * Status lifecycle (`CategoryStatus`):
 *  - ACTIVE    -> visible on the storefront, usable by products.
 *  - INACTIVE  -> hidden, temporarily switched off.
 *  - ARCHIVED  -> hidden, retired (kept for history / restore).
 *
 * Leaving ACTIVE (to INACTIVE or ARCHIVED) is guarded: no products, no
 * children and never the last ACTIVE category. Hard delete is allowed only
 * when nothing references the category.
 *
 * Depends only on infrastructure (prisma, cache, media, locale), never on
 * `CatalogService`, so product code can depend on it without cycles.
 */
@Injectable()
export class CategoryService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly cache: CatalogCacheService,
        private readonly media: MediaService,
        private readonly mediaValidator: CatalogMediaValidator,
        private readonly locale: LocaleService,
        private readonly i18n: I18nService,
    ) {}

    // ============ admin ============

    /**
     * Checks whether a category slug is available.
     *
     * Generates a slug from the title when no slug is provided. If the slug
     * already exists, suggests the next available slug by appending a number.
     * Optionally excludes a category ID when checking during updates.
     *
     * Queries the database directly to avoid stale cache results. The suggested
     * slug is not reserved; database uniqueness constraints remain authoritative.
     */
    async checkSlug(query: CheckCategorySlugInput) {
        if (!query.title?.trim() && !query.slug?.trim()) {
            throw new BadRequestException(
                this.i18n.translate("catalog.category.slugInputRequired"),
            );
        }

        const baseSlug = toUrlSlug(
            query.slug?.trim() || query.title?.trim() || "",
        );

        if (!baseSlug) {
            throw new BadRequestException(
                this.i18n.translate("catalog.category.slugInvalid"),
            );
        }

        const excludeId = query.excludeId ? query.excludeId : undefined;

        // Fetch only matching slugs. No cache: this must reflect current DB state.
        const rows = await this.prisma.category.findMany({
            where: {
                ...(excludeId !== undefined ? { id: { not: excludeId } } : {}),
                slug: { startsWith: baseSlug },
            },
            select: { slug: true },
        });

        const existingSlugs = new Set(rows.map((row) => row.slug));
        if (!existingSlugs.has(baseSlug)) {
            return { exists: false, slug: baseSlug, suggestion: null };
        }

        let n = 2;
        let suggestion = `${baseSlug}-${n}`;
        while (existingSlugs.has(suggestion)) suggestion = `${baseSlug}-${++n}`;
        return { exists: true, slug: baseSlug, suggestion };
    }

    /**
     * Creates or updates a category in ONE serializable transaction.
     *
     * - Validates localized maps and icon/banner media.
     * - `description` HTML is sanitized to the rich-text whitelist
     *   (see `rich-text.util.ts`); languages left empty are dropped.
     * - Parent must exist; a category can't be moved under itself or any of
     *   its descendants (cycle check); `depth = parent.depth + 1`.
     * - An ACTIVE category needs an ACTIVE parent.
     * - When the depth changes, all descendants' depth is shifted by the delta.
     * - `status`: defaults to ACTIVE on create, omitted on update keeps the
     *   current one. Leaving ACTIVE follows the same guards as `archive`.
     * - Slug: `dto.slug`, else derived from default-language name on create,
     *   untouched on update unless sent (409 if taken).
     * - Busts catalog AND product-detail caches (names are embedded there).
     */
    async upsert(dto: CategoryInput, id?: bigint) {
        await this.mediaValidator.assertImages([
            {
                id: dto.iconId,
                purpose: MediaPurpose.CATEGORY,
                profile: this.mediaValidator.profiles.CATEGORY!.master,
            },
            {
                id: dto.bannerId,
                purpose: MediaPurpose.CATEGORY_BANNER,
                profile: this.mediaValidator.profiles.CATEGORY_BANNER!.master,
            },
        ]);

        const name = this.locale.cleanMap(dto.name, "name")!;
        const description = sanitizeRichTextMap(
            this.locale.cleanMap(dto.description, "description", false),
        );

        const slug =
            dto.slug ??
            (id
                ? undefined
                : toUrlSlug(name[this.locale.defaultLanguage]) ||
                  `c-${randomToken(3)}`);

        let detached: (bigint | null)[] = [];
        const row = await this.prisma
            .$transaction(async (tx) => {
                let previous: {
                    status: CategoryStatus;
                    depth: number;
                    iconId: bigint | null;
                    bannerId: bigint | null;
                } | null = null;
                if (id) {
                    previous = await tx.category.findUnique({
                        where: { id },
                        select: {
                            status: true,
                            depth: true,
                            iconId: true,
                            bannerId: true,
                        },
                    });
                    if (!previous) {
                        throw new NotFoundException(
                            this.i18n.translate("catalog.category.notFound"),
                        );
                    }
                }

                const status =
                    dto.status ?? previous?.status ?? CategoryStatus.ACTIVE;

                let depth = 0;
                if (dto.parentId) {
                    const parent = await tx.category.findUnique({
                        where: { id: dto.parentId },
                    });
                    if (!parent) {
                        throw new NotFoundException(
                            this.i18n.translate(
                                "catalog.category.parentNotFound",
                            ),
                        );
                    }

                    if (id) await this.assertNotInOwnSubtree(tx, id, parent);
                    if (
                        status === CategoryStatus.ACTIVE &&
                        parent.status !== CategoryStatus.ACTIVE
                    ) {
                        throw new ConflictException(
                            this.i18n.translate(
                                "catalog.category.parentNotActive",
                            ),
                        );
                    }
                    depth = parent.depth + 1;
                }

                if (
                    id &&
                    previous?.status === CategoryStatus.ACTIVE &&
                    status !== CategoryStatus.ACTIVE
                ) {
                    await this.assertDeactivatable(tx, id);
                }

                const data = {
                    parentId: dto.parentId ?? null,
                    name,
                    description: description ?? null,
                    iconId: dto.iconId,
                    // PUT sends the whole form: no banner = remove it (same as brands).
                    bannerId: dto.bannerId ?? null,
                    depth,
                    position: dto.position ?? 0,
                    status,
                };

                if (!id) {
                    return tx.category.create({
                        data: { ...data, slug: slug! },
                    });
                }

                const updated = await tx.category.update({
                    where: { id },
                    data: { ...data, slug },
                });
                if (previous && previous.depth !== depth) {
                    await this.shiftDescendantDepth(
                        tx,
                        id,
                        depth - previous.depth,
                    );
                }
                detached = [previous!.iconId, previous!.bannerId].filter(
                    (m) => m != null && m !== data.iconId && m !== data.bannerId,
                );
                return updated;
            }, SERIALIZABLE)
            .catch((e) =>
                throwUniqueConflict(this.i18n, e, "catalog.category.slugTaken"),
            );

        await this.cache.bustAll();
        // Icon / banner removed or replaced: delete the old file unless something else uses it.
        await this.media.removeDetached(detached);
        return row;
    }

    /**
     * Changes the status of ONE category. Same rules as `bulkSetStatus`
     * (including `moveProductsTo` / `detachChildren`). Idempotent.
     */
    async setStatus(id: bigint, dto: CategoryStatusInput) {
        const r = await this.bulkSetStatus({
            ...dto,
            ids: [id],
            dryRun: false,
        });
        return {
            success: true,
            id: id.toString(),
            status: dto.status,
            moveProductsTo: r.moveProductsTo,
            movedProductCount: r.movedProductCount,
            movedListingCount: r.movedListingCount,
            detachedChildIds: r.detachedChildIds,
        };
    }

    /**
     * Changes the status of many categories in ONE serializable transaction.
     * All-or-nothing: if any category is blocked, nothing is saved and a 409
     * lists every blocker. Categories already in the target status are
     * reported as unchanged.
     *
     * Leaving ACTIVE (-> INACTIVE / ARCHIVED):
     *  - Products (incl. soft-deleted) or store listings use it -> blocked,
     *    unless `moveProductsTo` is given: they are reassigned to that
     *    ACTIVE category (not in the selection) before the status change.
     *  - Child categories NOT in the selection -> blocked, unless
     *    `detachChildren`: they become root categories (parentId removed,
     *    subtree depth shifted). Children inside the selection never block.
     *  - At least one ACTIVE category must remain.
     * Becoming ACTIVE:
     *  - Parent must be ACTIVE or part of the same request.
     * INACTIVE <-> ARCHIVED: no checks.
     *
     * `dryRun`: runs every check and returns the plan + blockers without
     * writing anything (used by the admin UI to show the "move products" dialog).
     */
    async bulkSetStatus(dto: CategoryBulkStatusInput) {
        const ids = [
            ...new Map(dto.ids.map((i) => [i.toString(), i])).values(),
        ];
        const status = dto.status;
        const deactivating = status !== CategoryStatus.ACTIVE;
        const dryRun = dto.dryRun === true;
        const detach = deactivating && dto.detachChildren === true;
        const moveTo = deactivating ? (dto.moveProductsTo ?? null) : null;

        if (!deactivating && dto.moveProductsTo) {
            throw new BadRequestException(
                this.t("catalog.category.moveTargetNotAllowed"),
            );
        }

        const lang = I18nContext.current()?.lang ?? this.locale.defaultLanguage;
        const nameOf = (row: { name: Prisma.JsonValue }) =>
            (this.locale.pick(row.name, lang) as string | null) ?? "";

        const result = await this.prisma.$transaction(
            async (tx) => {
                const rows = await tx.category.findMany({
                    where: { id: { in: ids } },
                    select: {
                        id: true,
                        status: true,
                        parentId: true,
                        name: true,
                    },
                });
                if (rows.length !== ids.length) {
                    const found = new Set(rows.map((r) => r.id.toString()));
                    const missing = ids.filter((i) => !found.has(i.toString()));
                    throw new NotFoundException(
                        ids.length === 1
                            ? this.t("catalog.category.notFound")
                            : this.t("catalog.category.bulkNotFound", {
                                  ids: missing.join(", "),
                              }),
                    );
                }

                const selected = new Set(ids.map((i) => i.toString()));
                const changing = rows.filter((r) => r.status !== status);
                const unchanged = rows.filter((r) => r.status === status);
                const blockers: CategoryStatusBlocker[] = [];

                let usage = new Map<string, CategoryUsage>();
                let externalChildren: {
                    id: bigint;
                    parentId: bigint | null;
                    depth: number;
                }[] = [];

                if (deactivating) {
                    if (moveTo)
                        await this.assertMoveTarget(tx, moveTo, selected);

                    const leaving = changing.filter(
                        (r) => r.status === CategoryStatus.ACTIVE,
                    );
                    const leavingIds = leaving.map((r) => r.id);

                    if (leavingIds.length) {
                        usage = await this.usageByCategory(tx, leavingIds);
                        externalChildren = await tx.category.findMany({
                            where: {
                                parentId: { in: leavingIds },
                                id: { notIn: ids },
                            },
                            select: { id: true, parentId: true, depth: true },
                        });

                        for (const r of leaving) {
                            const u = usage.get(r.id.toString());
                            if (u && !moveTo) {
                                blockers.push({
                                    id: r.id.toString(),
                                    code: "inUse",
                                    message: this.t(
                                        "catalog.category.blocker.inUse",
                                        {
                                            name: nameOf(r),
                                            products: u.products,
                                            listings: u.listings,
                                        },
                                    ),
                                    productCount: u.products,
                                    listingCount: u.listings,
                                });
                            }

                            const kids = externalChildren.filter(
                                (c) => c.parentId === r.id,
                            );
                            if (kids.length && !detach) {
                                blockers.push({
                                    id: r.id.toString(),
                                    code: "hasChildren",
                                    message: this.t(
                                        "catalog.category.blocker.hasChildren",
                                        { name: nameOf(r), count: kids.length },
                                    ),
                                    childIds: kids.map((c) => c.id.toString()),
                                });
                            }
                        }

                        const activeCount = await tx.category.count({
                            where: { status: CategoryStatus.ACTIVE },
                        });
                        if (activeCount - leavingIds.length < 1) {
                            blockers.push({
                                id: null,
                                code: "minimumRequired",
                                message: this.t(
                                    "catalog.category.minimumRequired",
                                ),
                            });
                        }
                    }
                } else {
                    // Parents inside the selection end up ACTIVE too, so only
                    // parents outside it need checking.
                    const outsideParentIds = [
                        ...new Map(
                            changing
                                .filter(
                                    (r) =>
                                        r.parentId != null &&
                                        !selected.has(r.parentId.toString()),
                                )
                                .map((r) => [
                                    r.parentId!.toString(),
                                    r.parentId!,
                                ]),
                        ).values(),
                    ];

                    if (outsideParentIds.length) {
                        const parents = await tx.category.findMany({
                            where: { id: { in: outsideParentIds } },
                            select: { id: true, status: true, name: true },
                        });
                        const byId = new Map(
                            parents.map((p) => [p.id.toString(), p]),
                        );
                        for (const r of changing) {
                            const p = r.parentId
                                ? byId.get(r.parentId.toString())
                                : undefined;
                            if (p && p.status !== CategoryStatus.ACTIVE) {
                                blockers.push({
                                    id: r.id.toString(),
                                    code: "parentNotActive",
                                    message: this.t(
                                        "catalog.category.blocker.parentNotActive",
                                        { name: nameOf(r), parent: nameOf(p) },
                                    ),
                                    parentId: p.id.toString(),
                                });
                            }
                        }
                    }
                }

                let products = 0;
                let listings = 0;
                for (const u of usage.values()) {
                    products += u.products;
                    listings += u.listings;
                }

                const summary = {
                    dryRun,
                    status,
                    updatedIds: changing.map((r) => r.id.toString()),
                    unchangedIds: unchanged.map((r) => r.id.toString()),
                    moveProductsTo: moveTo ? moveTo.toString() : null,
                    movedProductCount: moveTo ? products : 0,
                    movedListingCount: moveTo ? listings : 0,
                    detachedChildIds: detach
                        ? externalChildren.map((c) => c.id.toString())
                        : [],
                    blockers,
                };

                if (dryRun) {
                    return {
                        success: true,
                        canApply: blockers.length === 0,
                        ...summary,
                    };
                }
                if (blockers.length) throw this.blockedError(blockers);

                // 1. Reassign products + store listings.
                if (moveTo && usage.size) {
                    const from = [...usage.keys()].map((k) => BigInt(k));
                    const movedProducts = await tx.product.updateMany({
                        where: { categoryId: { in: from } },
                        data: { categoryId: moveTo },
                    });
                    const movedListings = await tx.storeProduct.updateMany({
                        where: { categoryId: { in: from } },
                        data: { categoryId: moveTo },
                    });
                    summary.movedProductCount = movedProducts.count;
                    summary.movedListingCount = movedListings.count;
                }

                // 2. Detach children outside the selection -> root categories.
                if (detach) {
                    for (const child of externalChildren) {
                        await tx.category.update({
                            where: { id: child.id },
                            data: { parentId: null, depth: 0 },
                        });
                        if (child.depth > 0) {
                            await this.shiftDescendantDepth(
                                tx,
                                child.id,
                                -child.depth,
                            );
                        }
                    }
                }

                // 3. Apply the status.
                if (changing.length) {
                    await tx.category.updateMany({
                        where: { id: { in: changing.map((r) => r.id) } },
                        data: { status },
                    });
                }

                return { success: true, canApply: true, ...summary };
            },
            // Moving many products can take longer than Prisma's 5s default.
            { ...SERIALIZABLE, timeout: 30_000 },
        );

        const changed =
            !result.dryRun &&
            (result.updatedIds.length > 0 ||
                result.movedProductCount > 0 ||
                result.movedListingCount > 0 ||
                result.detachedChildIds.length > 0);
        if (changed) await this.cache.bustAll();

        return result;
    }

    /**
     * Permanently deletes a category.
     *
     * Refused (409) while anything still uses it:
     *  - products (including soft-deleted ones, which can be restored),
     *  - store listings,
     *  - child categories,
     *  - being the last ACTIVE category.
     * Any other foreign key that still points at it surfaces as a Postgres
     * FK violation (P2003) and is also mapped to 409, so new relations are
     * protected even before this method learns about them.
     *
     * Media (icon / banner) is NOT deleted; it stays in the media library.
     */
    async remove(id: bigint) {
        await this.prisma
            .$transaction(async (tx) => {
                const category = await tx.category.findUnique({
                    where: { id },
                    select: { status: true },
                });
                if (!category) {
                    throw new NotFoundException(
                        this.i18n.translate("catalog.category.notFound"),
                    );
                }

                await this.assertUnused(tx, id);
                if (category.status === CategoryStatus.ACTIVE) {
                    await this.assertNotLastActive(tx);
                }

                await tx.category.delete({ where: { id } });
            }, SERIALIZABLE)
            .catch((e) => {
                if ((e as any)?.code === "P2003") {
                    throw new ConflictException(
                        this.i18n.translate("catalog.category.inUse"),
                    );
                }
                throw e;
            });

        await this.cache.bustAll();
        return { success: true, id: id.toString() };
    }

    async adminList(q: CategoryListInput) {
        const { take, skip, page, limit } = pageParams(q);

        // Exclude the given category IDs and all their descendants from the list.
        const subtree = q.excludeSubtreeOf?.length
            ? (
                  await Promise.all(
                      q.excludeSubtreeOf.map((id) => this.descendantIds(id)),
                  )
              ).flat()
            : [];

        // Remove duplicates from the combined list of excluded IDs and their descendants.
        const excluded = [...new Set([...subtree, ...(q.excludeIds ?? [])])];

        // Search across slug + allowed-language names.
        const term = q.q?.trim();
        const searchIds = term ? await this.searchIds(term) : null;

        // Build the Prisma where filter. AND is used to combine the optional filters for status, excluded IDs, and search IDs. If a filter is not provided, it is omitted from the where clause.
        const where: Prisma.CategoryWhereInput = {
            ...(q.status ? { status: q.status } : {}),
            // Categories directly in any of the selected groups.
            ...(q.groupIds?.length
                ? { groupItems: { some: { groupId: { in: q.groupIds } } } }
                : {}),
            AND: [
                ...(excluded.length ? [{ id: { notIn: excluded } }] : []),
                ...(searchIds ? [{ id: { in: searchIds } }] : []),
            ],
        };

        const [items, total] = await Promise.all([
            this.prisma.category.findMany({
                where,
                skip,
                take,
                orderBy: [
                    CATEGORY_ORDER_BY[q.sort as CategorySort] ??
                        CATEGORY_ORDER_BY.position_asc,
                    { id: "desc" },
                ],
                select: {
                    id: true,
                    slug: true,
                    name: true,
                    description: true,
                    parentId: true,
                    depth: true,
                    position: true,
                    status: true,
                    icon: { select: IMAGE_SELECT },
                    banner: { select: IMAGE_SELECT },
                    groupItems: {
                        select: {
                            group: { select: { id: true, slug: true, name: true } },
                        },
                    },
                    _count: {
                        select: {
                            // Live products only; soft-deleted ones are in the trash.
                            products: { where: { deletedAt: null } },
                        },
                    },
                },
            }),
            this.prisma.category.count({ where }),
        ]);

        return {
            items: items.map(({ icon, banner, description, groupItems, _count, ...x }) => ({
                ...x,
                /** Category groups this category is in. */
                groups: groupItems.map((g) => g.group),
                // Full HTML is not sent in the list; the edit form uses adminGet.
                shortDescription: richTextMapToPlain(
                    description,
                    CATEGORY_SHORT_DESCRIPTION_LENGTH,
                ),
                iconId: icon?.id ?? null,
                iconUrl: icon ? this.media.urlForVariant(icon, "thumb") : null,
                bannerId: banner?.id ?? null,
                bannerUrl: banner
                    ? this.media.urlForVariant(banner, "thumb")
                    : null,
                productCount: _count.products,
            })),
            total,
            page,
            limit,
        };
    }

    async adminGet(id: bigint) {
        const row = await this.prisma.category.findUnique({
            where: { id },
            select: {
                id: true,
                slug: true,
                name: true,
                description: true,
                parentId: true,
                depth: true,
                position: true,
                status: true,
                iconId: true,
                bannerId: true,
                icon: { select: IMAGE_SELECT },
                banner: { select: IMAGE_SELECT },
                parent: { select: { id: true, slug: true, name: true } },
                _count: { select: { children: true } },
                createdAt: true,
                updatedAt: true,
            },
        });
        if (!row) {
            throw new NotFoundException(
                this.i18n.translate("catalog.category.notFound"),
            );
        }

        const { icon, banner, _count, ...rest } = row;
        return {
            ...rest,
            iconUrl: icon ? this.media.urlForVariant(icon, "thumb") : null,
            bannerUrl: banner
                ? this.media.urlForVariant(banner, "master")
                : null,
            childCount: _count.children,
        };
    }

    /**
     * Returns ids of categories whose slug OR translated name (in allowed
     * languages only) contains the search term.
     */
    private async searchIds(term: string): Promise<bigint[]> {
        // Escape LIKE wildcards so "50%" or "a_b" match literally.
        const pattern = `%${term.replace(/[\\%_]/g, "\\$&")}%`;

        // Only these language keys inside `name` are searched.
        const langs: string[] = [
            ...new Set([this.locale.defaultLanguage, ...this.locale.languages]),
        ];

        // Tagged template: `pattern` and `langs` are sent as bound parameters.
        const rows = await this.prisma.$queryRaw<{ id: bigint }[]>`
			SELECT c."id"
			FROM "Category" c
			WHERE c."slug" ILIKE ${pattern}
			OR EXISTS (
					SELECT 1
					FROM jsonb_each_text(c."name") AS t(lang, val)
					WHERE t.lang = ANY(${langs}::text[])
					AND t.val ILIKE ${pattern}
			)`;
        return rows.map((r) => r.id);
    }

    // ============ used by ProductService / CatalogService ============

    /**
     * Ensures a category exists AND is ACTIVE.
     * @throws NotFoundException | BadRequestException
     */
    async assertActive(id: bigint) {
        const c = await this.prisma.category.findUnique({
            where: { id },
            select: { id: true, status: true },
        });
        if (!c) {
            throw new NotFoundException(
                this.i18n.translate("catalog.category.notFound"),
            );
        }
        if (c.status !== CategoryStatus.ACTIVE) {
            throw new BadRequestException(
                this.i18n.translate("catalog.category.inactive"),
            );
        }
    }

    /**
     * A category id plus all descendant ids, walked over the cached flat list
     * (`cat:flat`).
     */
    async descendantIds(id: bigint): Promise<bigint[]> {
        const all = await this.cache.catalog(
            CatalogCacheService.keys.categoryFlat,
            () =>
                this.prisma.category.findMany({
                    select: { id: true, parentId: true },
                }),
        );

        const childrenOf = new Map<string, bigint[]>();
        for (const c of all) {
            if (c.parentId == null) continue;
            const key = c.parentId.toString();
            const list = childrenOf.get(key) ?? [];
            list.push(toBigInt(c.id));
            childrenOf.set(key, list);
        }

        const out = [id];
        const stack = [id.toString()];
        while (stack.length) {
            for (const child of childrenOf.get(stack.pop()!) ?? []) {
                out.push(child);
                stack.push(child.toString());
            }
        }
        return out;
    }

    /**
     * Category ids a product filter allows, sub-categories included, or `null`
     * when no category filter is set. Values of one kind are OR-ed; when both
     * `categoryIds` and `groupIds` are given, the result is their intersection
     * (e.g. group "Vegetables & Fruits" AND category "Fresh Fruits").
     * An empty array means nothing matches.
     */
    async resolveFilter(f: {
        categoryIds?: bigint[];
        groupIds?: bigint[];
    }): Promise<bigint[] | null> {
        const byCategory = f.categoryIds?.length
            ? await this.subtrees(f.categoryIds)
            : null;
        let byGroup: bigint[] | null = null;
        if (f.groupIds?.length) {
            const items = await this.prisma.categoryGroupItem.findMany({
                where: { groupId: { in: f.groupIds } },
                select: { categoryId: true },
            });
            byGroup = await this.subtrees(items.map((i) => i.categoryId));
        }
        if (byCategory && byGroup) {
            const inGroup = new Set(byGroup.map(String));
            return byCategory.filter((id) => inGroup.has(String(id)));
        }
        return byCategory ?? byGroup;
    }

    /** Union of `descendantIds` for several roots, without duplicates. */
    private async subtrees(ids: bigint[]): Promise<bigint[]> {
        const all = await Promise.all(
            [...new Set(ids.map(String))].map((id) =>
                this.descendantIds(BigInt(id)),
            ),
        );
        return [...new Map(all.flat().map((id) => [String(id), id])).values()];
    }

    // ============ storefront ============

    /**
     * ACTIVE category tree localized to `lang`. The flat rows are cached
     * (`cat:tree`); localization and tree assembly happen per request.
     */
    async tree(lang: string) {
        const language = (lang ?? this.locale.defaultLanguage)
            .trim()
            .toLowerCase();

        const all = await this.cache.catalog(
            CatalogCacheService.keys.categoryTree,
            () =>
                this.prisma.category.findMany({
                    where: { status: CategoryStatus.ACTIVE },
                    select: {
                        id: true,
                        slug: true,
                        parentId: true,
                        name: true,
                        description: true,
                        icon: {
                            select: {
                                id: true,
                                key: true,
                                variants: true,
                                isPrivate: true,
                            },
                        },
                        banner: {
                            select: {
                                id: true,
                                key: true,
                                variants: true,
                                isPrivate: true,
                            },
                        },
                    },
                    orderBy: [{ depth: "asc" }, { position: "asc" }],
                }),
        );

        const nodes = new Map<string, any>();
        for (const c of all) {
            nodes.set(String(c.id), {
                id: c.id,
                slug: c.slug,
                name: this.locale.pick(c.name, language),
                description: this.locale.pick(c.description, language),
                iconUrl: c.icon
                    ? this.media.urlForVariant(c.icon, "thumb")
                    : null,
                bannerUrl: c.banner
                    ? this.media.urlForVariant(c.banner, "master")
                    : null,
                children: [],
            });
        }
        const roots: any[] = [];
        for (const c of all) {
            const node = nodes.get(String(c.id));
            const parent = c.parentId ? nodes.get(String(c.parentId)) : null;
            // An ACTIVE child under a non-active parent is promoted to a root
            // instead of silently disappearing.
            (parent ? parent.children : roots).push(node);
        }
        return roots;
    }

    // ============ private ============

    /** Translates with named args (`{name}` placeholders). */
    private t(key: string, args?: Record<string, unknown>): string {
        return this.i18n.translate(key, args ? { args } : undefined) as string;
    }

    /** 409 carrying every blocker so the UI can resolve them in one go. */
    private blockedError(blockers: CategoryStatusBlocker[]) {
        return new ConflictException({
            statusCode: 409,
            error: "Conflict",
            message:
                blockers.length === 1
                    ? blockers[0].message
                    : this.t("catalog.category.bulkBlocked", {
                          count: blockers.length,
                      }),
            blockers,
        });
    }

    /** Products (incl. soft-deleted) and store listings per category; only used ones are returned. */
    private async usageByCategory(
        tx: Prisma.TransactionClient,
        ids: bigint[],
    ): Promise<Map<string, CategoryUsage>> {
        const [products, listings] = await Promise.all([
            tx.product.groupBy({
                by: ["categoryId"],
                where: { categoryId: { in: ids } },
                _count: { _all: true },
            }),
            tx.storeProduct.groupBy({
                by: ["categoryId"],
                where: { categoryId: { in: ids } },
                _count: { _all: true },
            }),
        ]);

        const usage = new Map<string, CategoryUsage>();
        const entry = (id: bigint) => {
            const key = id.toString();
            let u = usage.get(key);
            if (!u) {
                u = { products: 0, listings: 0 };
                usage.set(key, u);
            }
            return u;
        };
        for (const p of products) entry(p.categoryId).products = p._count._all;
        for (const l of listings) {
            if (l.categoryId != null)
                entry(l.categoryId).listings = l._count._all;
        }
        return usage;
    }

    /** `moveProductsTo` must exist, be ACTIVE and not be part of the change. */
    private async assertMoveTarget(
        tx: Prisma.TransactionClient,
        targetId: bigint,
        selected: Set<string>,
    ) {
        if (selected.has(targetId.toString())) {
            throw new BadRequestException(
                this.t("catalog.category.moveTargetInSelection"),
            );
        }
        const target = await tx.category.findUnique({
            where: { id: targetId },
            select: { status: true },
        });
        if (!target) {
            throw new NotFoundException(
                this.t("catalog.category.moveTargetNotFound"),
            );
        }
        if (target.status !== CategoryStatus.ACTIVE) {
            throw new ConflictException(
                this.t("catalog.category.moveTargetNotActive"),
            );
        }
    }

    /** Nothing may reference the category: products, store listings, children. */
    private async assertUnused(tx: Prisma.TransactionClient, id: bigint) {
        const [productCount, listingCount, childCount] = await Promise.all([
            tx.product.count({ where: { categoryId: id } }),
            tx.storeProduct.count({ where: { categoryId: id } }),
            tx.category.count({ where: { parentId: id } }),
        ]);
        if (productCount > 0 || listingCount > 0) {
            throw new ConflictException(
                this.i18n.translate("catalog.category.inUse"),
            );
        }
        if (childCount > 0) {
            throw new ConflictException(
                this.i18n.translate("catalog.category.hasChildren"),
            );
        }
    }

    /** At least one ACTIVE category must always remain. */
    private async assertNotLastActive(tx: Prisma.TransactionClient) {
        const activeCount = await tx.category.count({
            where: { status: CategoryStatus.ACTIVE },
        });
        if (activeCount <= 1) {
            throw new ConflictException(
                this.i18n.translate("catalog.category.minimumRequired"),
            );
        }
    }

    /**
     * Guard for moving an ACTIVE category to INACTIVE / ARCHIVED: it must be
     * unused and must not be the last ACTIVE category.
     */
    private async assertDeactivatable(
        tx: Prisma.TransactionClient,
        id: bigint,
    ) {
        await this.assertUnused(tx, id);
        await this.assertNotLastActive(tx);
    }

    /**
     * Rejects moving `id` under itself or one of its own descendants by
     * walking up from the requested parent.
     */
    private async assertNotInOwnSubtree(
        tx: Prisma.TransactionClient,
        id: bigint,
        parent: { id: bigint; parentId: bigint | null },
    ) {
        if (parent.id === id) {
            throw new BadRequestException(
                this.i18n.translate("catalog.category.selfParent"),
            );
        }
        const seen = new Set<string>([parent.id.toString()]);
        let cursor = parent.parentId;
        while (cursor) {
            if (cursor === id) {
                throw new BadRequestException(
                    this.i18n.translate("catalog.category.cycle"),
                );
            }
            if (seen.has(cursor.toString())) break; // pre-existing corruption guard
            seen.add(cursor.toString());
            const next = await tx.category.findUnique({
                where: { id: cursor },
                select: { parentId: true },
            });
            cursor = next?.parentId ?? null;
        }
    }

    /** Shifts `depth` of every descendant of `id` by `delta` (level by level). */
    private async shiftDescendantDepth(
        tx: Prisma.TransactionClient,
        id: bigint,
        delta: number,
    ) {
        const descendants: bigint[] = [];
        let frontier = [id];
        while (frontier.length) {
            const kids = await tx.category.findMany({
                where: { parentId: { in: frontier } },
                select: { id: true },
            });
            frontier = kids.map((k) => k.id);
            descendants.push(...frontier);
        }
        if (descendants.length) {
            await tx.category.updateMany({
                where: { id: { in: descendants } },
                data: { depth: { increment: delta } },
            });
        }
    }
}
