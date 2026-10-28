import { pageParams, randomToken, toUrlSlug } from "@common/utils/helpers.util";
import { PrismaService } from "@core/database/prisma.service";
import { LocaleService } from "@core/locale/locale.service";
import { MediaService } from "@modules/media/media.service";
import {
    BadRequestException,
    Injectable,
    NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma-client/client";
import { CategoryStatus } from "@prisma-client/enums";
import { I18nService } from "nestjs-i18n";
import { CatalogCacheService } from "../shared/catalog-cache.service";
import { throwUniqueConflict } from "../shared/catalog.util";
import {
    CATEGORY_GROUP_MAX_ITEMS,
    CategoryGroupInput,
    CategoryGroupListInput,
} from "./category-group.types";

const SERIALIZABLE = {
    isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
} as const;

const IMAGE = { id: true, key: true, variants: true, isPrivate: true } as const;

/** Redis key of the storefront list (raw rows; localized per request). */
const CACHE_KEY = "cat:groups";

/**
 * Category groups: a display grouping of categories ("Vegetables & Fruits" →
 * Fresh Vegetables, Fresh Fruits, …). A group holds categories only; products
 * are never assigned to it, and a category may sit in several groups.
 * HTTP: src/api/admin/catalog/category-groups (admin), src/api/public/catalog (storefront).
 */
@Injectable()
export class CategoryGroupService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly cache: CatalogCacheService,
        private readonly media: MediaService,
        private readonly locale: LocaleService,
        private readonly i18n: I18nService,
    ) {}

    private t(key: string, args?: Record<string, unknown>) {
        return this.i18n.translate(`catalog.categoryGroup.${key}`, args ? { args } : {}) as string;
    }

    // ============ admin ============

    async adminList(query: CategoryGroupListInput) {
        const { take, skip, page, limit } = pageParams(query);
        const q = query.q?.trim();
        const where: Prisma.CategoryGroupWhereInput = {
            ...(query.status && { status: query.status }),
            ...(query.categoryId && { items: { some: { categoryId: query.categoryId } } }),
            ...(q && {
                OR: [
                    { slug: { contains: q.toLowerCase() } },
                    { id: { in: await this.idsByName(q) } },
                ],
            }),
        };
        const [rows, total] = await Promise.all([
            this.prisma.categoryGroup.findMany({
                where,
                orderBy: [{ position: "asc" }, { id: "asc" }],
                take,
                skip,
                select: {
                    id: true,
                    slug: true,
                    name: true,
                    status: true,
                    position: true,
                    _count: { select: { items: true } },
                    updatedAt: true,
                },
            }),
            this.prisma.categoryGroup.count({ where }),
        ]);
        return {
            items: rows.map(({ _count, ...g }) => ({
                ...g,
                categoryCount: _count.items,
            })),
            total,
            page,
            limit,
        };
    }

    async adminGet(id: bigint) {
        const g = await this.prisma.categoryGroup.findUnique({
            where: { id },
            include: {
                items: {
                    orderBy: { position: "asc" },
                    select: {
                        category: {
                            select: {
                                id: true,
                                slug: true,
                                name: true,
                                status: true,
                                depth: true,
                                icon: { select: IMAGE },
                            },
                        },
                    },
                },
            },
        });
        if (!g) throw new NotFoundException({ message: this.t("notFound"), code: "CATEGORY_GROUP_NOT_FOUND" });
        const { items, ...rest } = g;
        return {
            ...rest,
            categories: items.map(({ category: { icon: ci, ...c } }) => ({
                ...c,
                iconUrl: ci ? this.media.urlForVariant(ci, "thumb") : null,
            })),
        };
    }

    /**
     * Create (no `id`) or replace (PUT) a group. `categoryIds` is the full,
     * ordered list; on update it replaces the old one.
     */
    async upsert(dto: CategoryGroupInput, id?: bigint) {
        const categoryIds = [...new Map(dto.categoryIds.map((c) => [c.toString(), c])).values()];
        if (categoryIds.length > CATEGORY_GROUP_MAX_ITEMS)
            throw new BadRequestException({
                message: this.t("tooManyCategories", { max: CATEGORY_GROUP_MAX_ITEMS }),
                code: "TOO_MANY_CATEGORIES",
            });

        const name = this.locale.cleanMap(dto.name, "name")!;
        const description = dto.description
            ? this.locale.cleanMap(dto.description, "description", false)
            : null;
        const slug =
            dto.slug ??
            (id ? undefined : toUrlSlug(name[this.locale.defaultLanguage]) || `g-${randomToken(3)}`);

        const row = await this.prisma
            .$transaction(async (tx) => {
                const found = await tx.category.findMany({
                    where: { id: { in: categoryIds } },
                    select: { id: true },
                });
                if (found.length !== categoryIds.length) {
                    const known = new Set(found.map((c) => c.id.toString()));
                    throw new BadRequestException({
                        message: this.t("categoryNotFound"),
                        code: "CATEGORY_NOT_FOUND",
                        missing: categoryIds.map(String).filter((c) => !known.has(c)),
                    });
                }

                const data = {
                    name,
                    description: description ?? Prisma.DbNull,
                    status: dto.status ?? CategoryStatus.ACTIVE,
                    position: dto.position ?? 0,
                };
                const items = categoryIds.map((categoryId, position) => ({ categoryId, position }));

                if (!id) {
                    return tx.categoryGroup.create({
                        data: { ...data, slug: slug!, items: { create: items } },
                    });
                }

                const previous = await tx.categoryGroup.findUnique({
                    where: { id },
                    select: { status: true },
                });
                if (!previous)
                    throw new NotFoundException({ message: this.t("notFound"), code: "CATEGORY_GROUP_NOT_FOUND" });
                const updated = await tx.categoryGroup.update({
                    where: { id },
                    data: {
                        ...data,
                        status: dto.status ?? previous.status,
                        ...(slug && { slug }),
                        items: { deleteMany: {}, create: items },
                    },
                });
                return updated;
            }, SERIALIZABLE)
            .catch((e) => throwUniqueConflict(this.i18n, e, "catalog.categoryGroup.slugTaken"));

        await this.cache.bust();
        return this.adminGet(row.id);
    }

    /** Status only (show / hide a group in the storefront). */
    async setStatus(id: bigint, status: CategoryStatus) {
        await this.mustExist(id);
        await this.prisma.categoryGroup.update({ where: { id }, data: { status } });
        await this.cache.bust();
        return this.adminGet(id);
    }

    /** Hard delete: removes the group and its memberships; categories and products are untouched. */
    async remove(id: bigint) {
        await this.mustExist(id);
        await this.prisma.categoryGroup.delete({ where: { id } });
        await this.cache.bust();
        return { success: true };
    }

    // ============ storefront ============

    /**
     * ACTIVE groups (by position) with their ACTIVE categories (in the group's
     * order). Groups left without an active category are not returned.
     */
    async storefront(lang: string) {
        const rows = await this.cache.catalog(CACHE_KEY, () =>
            this.prisma.categoryGroup.findMany({
                where: { status: CategoryStatus.ACTIVE },
                orderBy: [{ position: "asc" }, { id: "asc" }],
                select: {
                    id: true,
                    slug: true,
                    name: true,
                    description: true,
                    items: {
                        where: { category: { status: CategoryStatus.ACTIVE } },
                        orderBy: { position: "asc" },
                        select: {
                            category: {
                                select: { id: true, slug: true, name: true, icon: { select: IMAGE } },
                            },
                        },
                    },
                },
            }),
        );
        return rows
            .filter((g) => g.items.length)
            .map((g) => ({
                id: g.id,
                slug: g.slug,
                name: this.locale.pick(g.name, lang),
                description: g.description ? this.locale.pick(g.description, lang) : null,
                categories: g.items.map(({ category: c }) => ({
                    id: c.id,
                    slug: c.slug,
                    name: this.locale.pick(c.name, lang),
                    iconUrl: c.icon ? this.media.urlForVariant(c.icon, "thumb") : null,
                })),
            }));
    }

    /** One ACTIVE group by slug (404 when hidden or empty). */
    async storefrontOne(slug: string, lang: string) {
        const g = (await this.storefront(lang)).find((x) => x.slug === slug);
        if (!g) throw new NotFoundException({ message: this.t("notFound"), code: "CATEGORY_GROUP_NOT_FOUND" });
        return g;
    }

    // ============ private ============

    private async mustExist(id: bigint) {
        const g = await this.prisma.categoryGroup.findUnique({
            where: { id },
            select: { id: true },
        });
        if (!g) throw new NotFoundException({ message: this.t("notFound"), code: "CATEGORY_GROUP_NOT_FOUND" });
        return g;
    }

    /** Ids of groups whose name (any language) contains the term. */
    private async idsByName(term: string): Promise<bigint[]> {
        const rows = await this.prisma.$queryRaw<{ id: bigint }[]>`
            SELECT id FROM "CategoryGroup"
            WHERE EXISTS (SELECT 1 FROM jsonb_each_text(name) n WHERE n.value ILIKE ${"%" + term + "%"})
            LIMIT 200`;
        return rows.map((r) => r.id);
    }
}
