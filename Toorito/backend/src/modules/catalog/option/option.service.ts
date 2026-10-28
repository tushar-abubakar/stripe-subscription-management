import { pageParams, toBigInt } from "@common/utils/helpers.util";
import { PrismaService } from "@core/database/prisma.service";
import { LocaleService } from "@core/locale/locale.service";
import {
    OptionGroupInput,
    OptionListInput,
    OptionSort,
    OptionValueInput,
} from "./option.types";
import { CatalogCacheService } from "../shared/catalog-cache.service";
import { CatalogMediaValidator } from "../shared/catalog-media.validator";
import { MediaService } from "@modules/media/media.service";
import {
    BadRequestException,
    ConflictException,
    Injectable,
    NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma-client/client";
import { I18nService } from "nestjs-i18n";

/** Max length of option group / option value codes (matches the DTO). */
const CODE_MAX_LENGTH = 50;

const IMAGE_SELECT = {
    id: true,
    key: true,
    variants: true,
    isPrivate: true,
} as const;

/**
 * Maps the public `sort` query value to a Prisma `orderBy` for option groups.
 * Typed as `Record<OptionSort, ...>` so adding a value to the DTO without
 * handling it here is a compile error.
 */
const OPTION_GROUP_ORDER_BY: Record<
    OptionSort,
    Prisma.OptionGroupOrderByWithRelationInput
> = {
    id_asc: { id: "asc" },
    id_desc: { id: "desc" },
    code_asc: { code: "asc" },
    code_desc: { code: "desc" },
};

/**
 * Option domain service (option groups such as "Size" / "Color" and their values).
 *
 * Depends only on infrastructure (prisma, cache, media, locale), never on
 * `ProductService`, so product code can depend on it without cycles.
 */
@Injectable()
export class OptionService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly cache: CatalogCacheService,
        private readonly media: MediaService,
        private readonly mediaValidator: CatalogMediaValidator,
        private readonly locale: LocaleService,
        private readonly i18n: I18nService,
    ) {}

    // ============ used by ProductService ============

    /**
     * Ensures a list of option group ids is free of duplicates and that every
     * id exists. An empty list is valid (general product).
     *
     * @param optionGroupIds - Ordered option group ids chosen for a product.
     * @throws BadRequestException on duplicates or unknown ids.
     */
    async assertGroupsExist(optionGroupIds: bigint[]): Promise<void> {
        const uniqueCount = new Set(optionGroupIds.map((id) => id.toString()))
            .size;
        if (uniqueCount !== optionGroupIds.length) {
            throw new BadRequestException(
                this.i18n.translate("catalog.product.duplicateOptionGroup"),
            );
        }
        if (!optionGroupIds.length) return;

        const existingCount = await this.prisma.optionGroup.count({
            where: { id: { in: optionGroupIds } },
        });
        if (existingCount !== optionGroupIds.length) {
            throw new BadRequestException(
                this.i18n.translate("catalog.optionGroup.notFound"),
            );
        }
    }

    /**
     * Loads option values by id. Used to validate that a variant's values
     * belong to the product's option groups.
     *
     * Unknown ids are simply missing from the result; the caller decides
     * whether that is an error.
     *
     * @param optionValueIds - Option value ids to load (duplicates allowed).
     */
    async findValuesByIds(optionValueIds: bigint[]) {
        if (!optionValueIds.length) return [];
        return this.prisma.optionValue.findMany({
            where: { id: { in: [...new Set(optionValueIds)] } },
        });
    }

    // ============ admin ============

    private assertUniqueValueLabels(
        candidates: Array<{
            code: string;
            label: Record<string, string>;
        }>,
        existing: Array<{
            code: string;
            label: Record<string, string>;
        }>,
    ): void {
        const normalize = (value: string) => value.trim().toLocaleLowerCase();

        const seen = new Map<string, string>();

        // Include existing values, except values being updated by code.
        const candidateCodes = new Set(candidates.map((value) => value.code));

        for (const value of existing) {
            if (candidateCodes.has(value.code)) continue;

            for (const [language, label] of Object.entries(value.label)) {
                const key = `${language}:${normalize(label)}`;
                seen.set(key, value.code);
            }
        }

        // Validate submitted values against each other and existing values.
        for (const value of candidates) {
            for (const [language, label] of Object.entries(value.label)) {
                const key = `${language}:${normalize(label)}`;

                if (seen.has(key)) {
                    throw new BadRequestException(
                        this.i18n.translate(
                            "catalog.optionValue.duplicateLabel",
                        ),
                    );
                }

                seen.set(key, value.code);
            }
        }
    }

    private toLocaleMap(value: Prisma.JsonValue): Record<string, string> {
        if (
            value === null ||
            typeof value !== "object" ||
            Array.isArray(value)
        ) {
            return {};
        }

        return Object.fromEntries(
            Object.entries(value).filter(
                (entry): entry is [string, string] =>
                    typeof entry[1] === "string",
            ),
        );
    }

    /**
     * Creates or updates an option group (e.g. "Size", "Color") together
     * with its option values, atomically in one transaction.
     *
     * - The option group itself is created/updated first.
     * - Each value is upserted by the composite key
     *   `(optionGroupId, code)`; values missing from the payload are
     *   NOT deleted.
     * - Busts the catalog AND product-detail caches.
     *
     * @param dto - Option group payload including optional `values`.
     * @param id - Existing option group id; when omitted a new one is created.
     * @returns The persisted option group row (without values).
     */
    async upsertOptionGroup(dto: OptionGroupInput, id?: bigint) {
        const name = this.locale.cleanMap(dto.name, "name")!;
        const cleanedValues = (dto.values ?? []).map((value, index) => ({
            ...value,
            code: value.code?.trim() || undefined,
            label: this.locale.cleanMap(value.label, `values.${index}.label`)!,
        }));

        // Values without a code get one derived from their default-language
        // label. Codes are de-duplicated within the payload only, so a
        // generated code that already exists in the group upserts that value
        // (re-sending the same payload stays idempotent).
        const payloadCodes = new Set(
            cleanedValues.flatMap((value) => (value.code ? [value.code] : [])),
        );
        const values = cleanedValues.map((value) => {
            if (value.code) return { ...value, code: value.code };
            const code = this.pickFreeCode(
                this.codeFromLocaleMap(value.label, "VALUE"),
                payloadCodes,
            );
            payloadCodes.add(code);
            return { ...value, code };
        });

        const group = await this.prisma.$transaction(async (tx) => {
            const existingGroup = id
                ? await tx.optionGroup.findUnique({
                      where: { id },
                      select: {
                          id: true,
                          valueType: true,
                      },
                  })
                : null;

            if (id && !existingGroup) {
                throw new NotFoundException(
                    this.i18n.translate("catalog.optionGroup.notFound"),
                );
            }

            const valueType =
                dto.valueType ?? existingGroup?.valueType ?? "TEXT";

            const savedGroup = id
                ? await tx.optionGroup.update({
                      where: { id },
                      data: {
                          name,
                          valueType: dto.valueType,
                          isFilterable: dto.isFilterable,
                      },
                  })
                : await tx.optionGroup.create({
                      data: {
                          code:
                              dto.code?.trim() ||
                              (await this.uniqueGroupCode(
                                  this.codeFromLocaleMap(name, "OPTION"),
                                  tx,
                              )),
                          name,
                          valueType,
                          isFilterable: dto.isFilterable ?? false,
                      },
                  });

            // Clear image references from ALL existing values when
            // changing an IMAGE group to a non-IMAGE group.
            if (existingGroup?.valueType === "IMAGE" && valueType !== "IMAGE") {
                await tx.optionValue.updateMany({
                    where: {
                        optionGroupId: savedGroup.id,
                        imageId: { not: null },
                    },
                    data: {
                        imageId: null,
                    },
                });
            }

            const existingValues = await tx.optionValue.findMany({
                where: {
                    optionGroupId: savedGroup.id,
                    code: {
                        notIn: values.map((value) => value.code),
                    },
                },
                select: {
                    code: true,
                    label: true,
                },
            });

            this.assertUniqueValueLabels(
                values.map((value) => ({
                    code: value.code,
                    label: value.label,
                })),
                existingValues.map((value) => ({
                    code: value.code,
                    label: this.toLocaleMap(value.label),
                })),
            );

            for (const value of values) {
                const imageId = valueType === "IMAGE" ? value.imageId : null;

                await tx.optionValue.upsert({
                    where: {
                        optionGroupId_code: {
                            optionGroupId: savedGroup.id,
                            code: value.code,
                        },
                    },
                    update: {
                        label: value.label,
                        swatch: value.swatch,
                        imageId,
                        position: value.position ?? 0,
                    },
                    create: {
                        optionGroupId: savedGroup.id,
                        code: value.code,
                        label: value.label,
                        swatch: value.swatch,
                        imageId,
                        position: value.position ?? 0,
                    },
                });
            }

            return savedGroup;
        });

        await this.cache.bustAll();
        return group;
    }

    /**
     * Paginated list of option groups with their values (ordered by
     * `position`), with slug / name / value search.
     */
    async listOptionGroups(q: OptionListInput) {
        const { take, skip, page, limit } = pageParams(q);

        const searchTerm = q.q?.trim();
        const searchIds = searchTerm ? await this.searchIds(searchTerm) : null;

        // Both filters are combined with AND so one never overwrites the other.
        const where: Prisma.OptionGroupWhereInput = {
            AND: [
                ...(q.excludeIds?.length
                    ? [{ id: { notIn: q.excludeIds } }]
                    : []),
                ...(searchIds !== null ? [{ id: { in: searchIds } }] : []),
            ],
        };

        const [groups, total] = await Promise.all([
            this.prisma.optionGroup.findMany({
                where,
                skip,
                take,
                orderBy: [
                    OPTION_GROUP_ORDER_BY[q.sort as OptionSort] ??
                        OPTION_GROUP_ORDER_BY.id_desc,
                    { id: "desc" },
                ],
                select: {
                    id: true,
                    code: true,
                    name: true,
                    valueType: true,
                    isFilterable: true,
                    values: {
                        orderBy: { position: "asc" },
                        select: {
                            id: true,
                            code: true,
                            label: true,
                            swatch: true,
                            imageId: true,
                            image: true,
                        },
                    },
                },
            }),
            this.prisma.optionGroup.count({ where }),
        ]);

        return {
            items: groups.map(({ values, ...group }) => ({
                ...group,
                values: values.map(({ image, ...value }) => ({
                    ...value,
                    imageUrl: image
                        ? this.media.urlForVariant(image, "thumb")
                        : null,
                })),
            })),
            total,
            page,
            limit,
        };
    }

    /**
     * Ids of option groups whose code OR translated name OR any value
     * code / label (allowed languages only) contains the term.
     * LIKE wildcards in the term match literally.
     */
    private async searchIds(term: string): Promise<bigint[]> {
        // Escape LIKE wildcards so "50%" or "a_b" match literally.
        const pattern = `%${term.replace(/[\\%_]/g, "\\$&")}%`;

        // Only these language keys inside the JSON maps are searched.
        const languages: string[] = [
            ...new Set([this.locale.defaultLanguage, ...this.locale.languages]),
        ];

        const rows = await this.prisma.$queryRaw<{ id: bigint }[]>`
			SELECT og."id"
			FROM "OptionGroup" og
			WHERE
				og."code" ILIKE ${pattern} ESCAPE E'\\\\'

				OR EXISTS (
					SELECT 1
					FROM jsonb_each_text(og."name") AS t(lang, val)
					WHERE t.lang = ANY(${languages}::text[])
					AND t.val ILIKE ${pattern} ESCAPE E'\\\\'
				)

				OR EXISTS (
					SELECT 1
					FROM "OptionValue" ov
					WHERE ov."optionGroupId" = og."id"
					AND (
						ov."code" ILIKE ${pattern} ESCAPE E'\\\\'

						OR EXISTS (
							SELECT 1
							FROM jsonb_each_text(ov."label") AS t(lang, val)
							WHERE t.lang = ANY(${languages}::text[])
								AND t.val ILIKE ${pattern} ESCAPE E'\\\\'
						)
					)
				)
    		`;
        return rows.map((row) => row.id);
    }

    /** Single option group with its ordered values. */
    async getOptionGroup(id: bigint) {
        const optionGroup = await this.prisma.optionGroup.findUnique({
            where: { id },
            include: { values: { orderBy: { position: "asc" } } },
        });
        if (!optionGroup) {
            throw new NotFoundException(
                this.i18n.translate("catalog.optionGroup.notFound"),
            );
        }
        return optionGroup;
    }

    /** All values of one option group, ordered by position. */
    async listOptionValues(id: bigint) {
        const optionGroup = await this.prisma.optionGroup.findUnique({
            where: { id },
            select: { id: true },
        });
        if (!optionGroup) {
            throw new NotFoundException(
                this.i18n.translate("catalog.optionGroup.notFound"),
            );
        }
        return this.prisma.optionValue.findMany({
            where: { optionGroupId: id },
            orderBy: [{ position: "asc" }, { id: "asc" }],
        });
    }

    /**
     * Deletes an option group and its values.
     * Refused (409) while a product or variant still uses the group.
     */
    async deleteOptionGroup(id: bigint) {
        const optionGroup = await this.prisma.optionGroup.findUnique({
            where: { id },
            select: { id: true },
        });
        if (!optionGroup) {
            throw new NotFoundException(
                this.i18n.translate("catalog.optionGroup.notFound"),
            );
        }

        const [productOptionCount, variantAssignmentCount] = await Promise.all([
            this.prisma.productOption.count({ where: { optionGroupId: id } }),
            this.prisma.variantOptionValue.count({
                where: { optionGroupId: id },
            }),
        ]);

        if (productOptionCount > 0 || variantAssignmentCount > 0) {
            throw new ConflictException(
                this.i18n.translate("catalog.optionGroup.inUse"),
            );
        }

        await this.prisma.$transaction(async (tx) => {
            await tx.optionValue.deleteMany({ where: { optionGroupId: id } });
            await tx.optionGroup.delete({ where: { id } });
        });
        await this.cache.bustAll();
        return { success: true, id: id.toString() };
    }

    /** Creates or updates one value of an option group. */
    async upsertOptionValue(
        optionGroupId: bigint,
        dto: OptionValueInput,
        valueId?: bigint,
    ) {
        const optionGroup = await this.prisma.optionGroup.findUnique({
            where: { id: optionGroupId },
            select: { id: true },
        });
        if (!optionGroup) {
            throw new NotFoundException(
                this.i18n.translate("catalog.optionGroup.notFound"),
            );
        }

        const label = this.locale.cleanMap(dto.label, "label")!;
        const code = dto.code?.trim() || undefined;

        const existingValues = await this.prisma.optionValue.findMany({
            where: {
                optionGroupId,
                ...(valueId ? { id: { not: valueId } } : {}),
            },
            select: {
                code: true,
                label: true,
            },
        });

        this.assertUniqueValueLabels(
            [
                {
                    code:
                        code ??
                        (valueId
                            ? (
                                  await this.prisma.optionValue.findUniqueOrThrow(
                                      {
                                          where: { id: valueId },
                                          select: { code: true },
                                      },
                                  )
                              ).code
                            : ""),
                    label,
                },
            ],
            existingValues.map((value) => ({
                code: value.code,
                label: this.toLocaleMap(value.label),
            })),
        );

        if (valueId) {
            const existingValue = await this.prisma.optionValue.findFirst({
                where: { id: valueId, optionGroupId },
                select: { id: true },
            });
            if (!existingValue) {
                throw new NotFoundException(
                    this.i18n.translate("catalog.optionValue.notFound"),
                );
            }
            const updatedValue = await this.prisma.optionValue.update({
                where: { id: valueId },
                data: {
                    // Omitted code → `undefined` → Prisma keeps the existing one.
                    code,
                    label,
                    swatch: dto.swatch,
                    imageId: toBigInt(dto.imageId),
                    position: dto.position ?? 0,
                },
            });
            await this.cache.bustAll();
            return updatedValue;
        }

        const createdValue = await this.prisma.optionValue.create({
            data: {
                optionGroupId,
                code:
                    code ??
                    (await this.uniqueValueCode(
                        optionGroupId,
                        this.codeFromLocaleMap(label, "VALUE"),
                    )),
                label,
                swatch: dto.swatch,
                imageId: toBigInt(dto.imageId),
                position: dto.position ?? 0,
            },
        });
        await this.cache.bustAll();
        return createdValue;
    }

    /** Deletes one option value. Refused (409) while a variant uses it. */
    async deleteOptionValue(optionGroupId: bigint, valueId: bigint) {
        const optionValue = await this.prisma.optionValue.findFirst({
            where: { id: valueId, optionGroupId },
            select: { id: true },
        });
        if (!optionValue) {
            throw new NotFoundException(
                this.i18n.translate("catalog.optionValue.notFound"),
            );
        }
        const usageCount = await this.prisma.variantOptionValue.count({
            where: { optionValueId: valueId },
        });
        if (usageCount > 0) {
            throw new ConflictException(
                this.i18n.translate("catalog.optionValue.inUse"),
            );
        }
        await this.prisma.optionValue.delete({ where: { id: valueId } });
        await this.cache.bustAll();
        return { success: true, id: valueId.toString() };
    }

    // ============ code generation ============

    /**
     * Builds an UPPER_SNAKE code from a localized map, using the default
     * language first and falling back to the first non-empty translation.
     * Latin accents are stripped; other scripts (e.g. Devanagari, Gurmukhi)
     * are kept as-is.
     *
     * @example { en: "Dark Red" } → "DARK_RED"
     * @param map - Localized names / labels (already cleaned).
     * @param fallback - Used when nothing usable remains (e.g. only symbols).
     */
    private codeFromLocaleMap(
        map: Record<string, string>,
        fallback: string,
    ): string {
        const source =
            map[this.locale.defaultLanguage]?.trim() ||
            Object.values(map).find((text) => text?.trim()) ||
            "";

        const code = source
            .normalize("NFKD")
            .replace(/[\u0300-\u036f]/g, "") // Latin diacritics only
            .replace(/[^\p{L}\p{N}\p{M}]+/gu, "_")
            .replace(/^_+|_+$/g, "")
            .toUpperCase()
            .slice(0, CODE_MAX_LENGTH)
            .replace(/_+$/, "");

        return code || fallback;
    }

    /** `base` for n = 1, otherwise `base_n`, truncated to fit the max length. */
    private codeWithSuffix(base: string, n: number): string {
        if (n <= 1) return base;
        const suffix = `_${n}`;
        const head = base
            .slice(0, CODE_MAX_LENGTH - suffix.length)
            .replace(/_+$/, "");
        return `${head}${suffix}`;
    }

    /** First of `base`, `base_2`, `base_3`, … that is not in `taken`. */
    private pickFreeCode(base: string, taken: Set<string>): string {
        for (let n = 1; ; n++) {
            const candidate = this.codeWithSuffix(base, n);
            if (!taken.has(candidate)) return candidate;
        }
    }

    /** A group code derived from `base` that no other group uses. */
    private async uniqueGroupCode(
        base: string,
        db: Prisma.TransactionClient = this.prisma,
    ): Promise<string> {
        const rows = await db.optionGroup.findMany({
            where: { code: { startsWith: this.codePrefix(base) } },
            select: { code: true },
        });
        return this.pickFreeCode(base, new Set(rows.map((row) => row.code)));
    }

    /** A value code derived from `base` that is unused within the group. */
    private async uniqueValueCode(
        optionGroupId: bigint,
        base: string,
        db: Prisma.TransactionClient = this.prisma,
    ): Promise<string> {
        const rows = await db.optionValue.findMany({
            where: {
                optionGroupId,
                code: { startsWith: this.codePrefix(base) },
            },
            select: { code: true },
        });
        return this.pickFreeCode(base, new Set(rows.map((row) => row.code)));
    }

    /**
     * Prefix shared by `base` and every suffixed variant of it (suffixes may
     * truncate the base), so one query finds all potential collisions.
     */
    private codePrefix(base: string): string {
        return base.slice(0, CODE_MAX_LENGTH - 6);
    }
}
