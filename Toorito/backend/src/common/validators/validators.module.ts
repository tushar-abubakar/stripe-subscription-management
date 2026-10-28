import { HasDefaultLanguageConstraint } from "@common/validators/has-default-language.validator";
import { IsE164PhoneConstraint } from "@common/validators/is-e164-phone.validator";
import { IsLocaleMapConstraint } from "@common/validators/is-locale-map.validator";
import { IsSupportedLanguageConstraint } from "@common/validators/is-supported-language.validator";
import { Global, Module } from "@nestjs/common";

/**
 * Registers the custom class-validator constraints in the Nest container so
 * they can inject `ConfigService` / `LocaleService`
 * (see `useContainer()` in `main.ts`).
 */
@Global()
@Module({
    providers: [
        IsE164PhoneConstraint,
        IsLocaleMapConstraint,
        IsSupportedLanguageConstraint,
        HasDefaultLanguageConstraint,
    ],
    exports: [
        IsE164PhoneConstraint,
        IsLocaleMapConstraint,
        IsSupportedLanguageConstraint,
        HasDefaultLanguageConstraint,
    ],
})
export class ValidatorsModule {}
