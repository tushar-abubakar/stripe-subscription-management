import { ConflictException } from "@nestjs/common";
import { I18nService } from "nestjs-i18n";

/**
 * Translates a Prisma unique-constraint violation (P2002) into a 409.
 * Any other error is re-thrown untouched.
 *
 * - target contains `sku`        -> `catalog.variant.skuExists`
 * - target contains `optionHash` -> `catalog.variant.combinationExists`
 * - anything else                -> `fallbackKey`
 */
export function throwUniqueConflict(
    i18n: I18nService,
    e: unknown,
    fallbackKey = "catalog.product.slugTaken",
): never {
    if ((e as any)?.code === "P2002") {
        const target = JSON.stringify((e as any)?.meta?.target ?? "");
        const key = target.includes("sku")
            ? "catalog.variant.skuExists"
            : target.includes("optionHash")
              ? "catalog.variant.combinationExists"
              : fallbackKey;
        throw new ConflictException(i18n.translate(key));
    }
    throw e;
}
