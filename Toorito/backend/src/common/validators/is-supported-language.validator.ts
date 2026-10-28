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

/** The value must be one of the languages configured in `LANGUAGES`. */
@ValidatorConstraint({ name: "isSupportedLanguage", async: false })
@Injectable()
export class IsSupportedLanguageConstraint implements ValidatorConstraintInterface {
    constructor(private readonly locale: LocaleService) {}

    validate(value: unknown): boolean {
        return this.locale.isSupported(value);
    }

    defaultMessage(args: ValidationArguments): string {
        return messageKey("validation.language.unsupported", {
            property: args.property,
            language: String(args.value),
            languages: this.locale.languages.join(", "),
        });
    }
}

export function IsSupportedLanguage(
    options?: ValidationOptions,
): PropertyDecorator {
    return (target, propertyKey) => {
        registerDecorator({
            target: target.constructor,
            propertyName: propertyKey as string,
            options,
            constraints: [],
            validator: IsSupportedLanguageConstraint,
        });
    };
}
