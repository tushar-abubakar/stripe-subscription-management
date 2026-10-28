import { messageKey } from "@common/utils/localeMessage.util";
import { LocaleService } from "@core/locale/locale.service";
import { Injectable } from "@nestjs/common";
import {
    registerDecorator,
    ValidationArguments,
    ValidationOptions,
    ValidatorConstraint,
    ValidatorConstraintInterface,
} from "class-validator";

/**
 * For arrays of `{ lang: string, ... }`: the default language must be present
 * and no language may be repeated.
 */
@ValidatorConstraint({ name: "hasDefaultLanguage", async: false })
@Injectable()
export class HasDefaultLanguageConstraint implements ValidatorConstraintInterface {
    constructor(private readonly locale: LocaleService) {}

    validate(value: unknown): boolean {
        if (!Array.isArray(value)) {
            return false;
        }

        const languages = value.map((item) =>
            String((item as { lang?: unknown })?.lang ?? "").toLowerCase(),
        );

        return (
            languages.includes(this.locale.defaultLanguage) &&
            new Set(languages).size === languages.length
        );
    }

    defaultMessage(args: ValidationArguments): string {
        return messageKey("catalog.translation.defaultRequired", {
            property: args.property,
            language: this.locale.defaultLanguage,
        });
    }
}

export function HasDefaultLanguage(
    options?: ValidationOptions,
): PropertyDecorator {
    return (target, propertyKey) => {
        registerDecorator({
            target: target.constructor,
            propertyName: propertyKey as string,
            options,
            constraints: [],
            validator: HasDefaultLanguageConstraint,
        });
    };
}
