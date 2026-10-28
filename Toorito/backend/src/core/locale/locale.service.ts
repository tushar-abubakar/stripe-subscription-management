import { MessageEnvelope, messageKey } from "@common/utils/localeMessage.util";
import { BadRequestException, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { I18nService } from "nestjs-i18n";

/** `{ en: "Milk", hi: "दूध" }` — one string per supported language. */
export type LocaleMap = Record<string, string>;

/**
 * Central place for everything language related.
 *
 * - The supported languages and the default language come from the
 *   environment (`LANGUAGES`, `DEFAULT_LANGUAGE`) through `ConfigService`;
 *   there is no database table for them.
 * - Translatable database columns (JSON locale maps) are validated, cleaned
 *   and read through this service.
 */
@Injectable()
export class LocaleService {
    readonly languages: string[];
    readonly defaultLanguage: string;

    private readonly languageSet: ReadonlySet<string>;

    constructor(
        private readonly config: ConfigService,
        private readonly i18n: I18nService,
    ) {
        this.languages = this.config
            .getOrThrow<string[]>("i18n.languages")
            .map((language) => language.trim().toLowerCase());

        this.defaultLanguage = this.config
            .getOrThrow<string>("i18n.defaultLanguage")
            .trim()
            .toLowerCase();

        this.languageSet = new Set(this.languages);
    }

    /** True when the language is one of the configured languages. */
    isSupported(language?: unknown): boolean {
        return (
            typeof language === "string" &&
            this.languageSet.has(language.trim().toLowerCase())
        );
    }

    /**
     * Resolves an `Accept-Language` style value ("hi-IN,hi;q=0.9,en;q=0.8")
     * to a supported language, falling back to the default language.
     */
    resolve(requested?: string): string {
        if (!requested) {
            return this.defaultLanguage;
        }

        for (const part of requested.split(",")) {
            const language = part.split(";")[0].trim().toLowerCase();

            if (this.isSupported(language)) {
                return language;
            }

            const baseLanguage = language.split("-")[0];

            if (this.isSupported(baseLanguage)) {
                return baseLanguage;
            }
        }

        return this.defaultLanguage;
    }

    /**
     * Returns the text for `language` from a locale map.
     *
     * Fallback order: requested language -> default language -> first
     * non-empty translation -> empty string. Accepts raw Prisma JSON.
     */
    pick(value: unknown, language?: string): string {
        if (
            value === null ||
            typeof value !== "object" ||
            Array.isArray(value)
        ) {
            return "";
        }

        const map = value as Record<string, unknown>;
        const requested = language?.toLowerCase() ?? this.defaultLanguage;

        for (const candidate of [requested, this.defaultLanguage]) {
            const text = map[candidate];

            if (typeof text === "string" && text.trim().length > 0) {
                return text;
            }
        }

        for (const text of Object.values(map)) {
            if (typeof text === "string" && text.trim().length > 0) {
                return text;
            }
        }

        return "";
    }

    /**
     * Validates a locale map and describes the first problem found.
     *
     * Rules:
     * - It must be a plain object (or null/undefined when optional).
     * - The default language is mandatory and must be a non-empty string.
     * - Only supported languages are allowed as keys.
     * - Other languages may be empty/null (they are dropped by `cleanMap`),
     *   but a non-empty value must be a string.
     *
     * @returns A translation envelope for the first violation, or `null`.
     */
    validateMap(
        value: unknown,
        field: string,
        required = true,
    ): MessageEnvelope | null {
        if (value === undefined || value === null) {
            return required
                ? { key: "validation.localeMap.object", args: { field } }
                : null;
        }

        if (typeof value !== "object" || Array.isArray(value)) {
            return { key: "validation.localeMap.object", args: { field } };
        }

        const map = value as Record<string, unknown>;

        // An empty optional map means "nothing provided".
        if (!required && Object.keys(map).length === 0) {
            return null;
        }

        const defaultValue = map[this.defaultLanguage];

        if (typeof defaultValue !== "string" || !defaultValue.trim()) {
            return {
                key: "validation.localeMap.defaultRequired",
                args: { field, language: this.defaultLanguage },
            };
        }

        for (const [language, translation] of Object.entries(map)) {
            if (!this.isSupported(language)) {
                return {
                    key: "validation.localeMap.unsupportedLanguage",
                    args: { field, language },
                };
            }

            const isEmpty =
                translation === null ||
                translation === undefined ||
                (typeof translation === "string" && !translation.trim());

            if (!isEmpty && typeof translation !== "string") {
                return {
                    key: "validation.localeMap.string",
                    args: { field, language },
                };
            }
        }

        return null;
    }

    /** Throws a translated 400 when the map is invalid (see {@link validateMap}). */
    assertMap(value: unknown, field: string, required = true): void {
        const problem = this.validateMap(value, field, required);

        if (problem) {
            throw new BadRequestException(
                this.i18n.translate(problem.key, { args: problem.args }),
            );
        }
    }

    /**
     * Validates the map and returns a trimmed copy without empty entries.
     *
     * `{ en: "Dairy", hi: "", bn: "  " }` becomes `{ en: "Dairy" }`.
     * Returns `undefined` when an optional map is not provided.
     */
    cleanMap(
        value: unknown,
        field = "value",
        required = true,
    ): LocaleMap | undefined {
        this.assertMap(value, field, required);

        if (!value || typeof value !== "object" || Array.isArray(value)) {
            return undefined;
        }

        const cleaned: LocaleMap = {};

        for (const [language, translation] of Object.entries(value)) {
            if (typeof translation !== "string") {
                continue;
            }

            const text = translation.trim();

            if (text) {
                cleaned[language.toLowerCase()] = text;
            }
        }

        return Object.keys(cleaned).length > 0 ? cleaned : undefined;
    }

    /** Envelope for code paths that cannot inject `I18nService`. */
    envelope(key: string, args?: Record<string, unknown>): string {
        return messageKey(key, args);
    }
}
