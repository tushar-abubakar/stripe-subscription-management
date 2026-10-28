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
 * Validates `{ [language]: text }` objects.
 *
 * All rules live in `LocaleService.validateMap`; this constraint only adapts
 * them to class-validator. The error message is a translation envelope that
 * the global exception filter translates with `I18nService.translate()`.
 */
@ValidatorConstraint({ name: "isLocaleMap", async: false })
@Injectable()
export class IsLocaleMapConstraint implements ValidatorConstraintInterface {
    constructor(private readonly locale: LocaleService) {}

    validate(value: unknown, args: ValidationArguments): boolean {
        const [required] = args.constraints as [boolean | undefined];

        // Optionality is decided by @IsOptional(); a present value is always checked.
        return (
            this.locale.validateMap(value, args.property, required ?? true) ===
            null
        );
    }

    defaultMessage(args: ValidationArguments): string {
        const [required] = args.constraints as [boolean | undefined];
        const problem = this.locale.validateMap(
            args.value,
            args.property,
            required ?? true,
        );

        return messageKey(
            problem?.key ?? "validation.localeMap.invalid",
            problem?.args ?? { field: args.property },
        );
    }
}

export function IsLocaleMap(options?: ValidationOptions): PropertyDecorator {
    return (target, propertyKey) => {
        registerDecorator({
            name: "isLocaleMap",
            target: target.constructor,
            propertyName: propertyKey as string,
            options,
            constraints: [],
            validator: IsLocaleMapConstraint,
        });
    };
}
