import { messageKey } from "@common/utils/localeMessage.util";
import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
    registerDecorator,
    ValidationArguments,
    ValidationOptions,
    ValidatorConstraint,
    ValidatorConstraintInterface,
} from "class-validator";
import { parsePhoneNumberFromString } from "libphonenumber-js";

/**
 * Accepts only strict E.164 numbers ("+919876543210") from the countries
 * listed in `PHONE_ALLOWED_COUNTRIES`.
 */
@ValidatorConstraint({ name: "isE164Phone", async: false })
@Injectable()
export class IsE164PhoneConstraint implements ValidatorConstraintInterface {
    private readonly allowedCountries: string[];

    constructor(config: ConfigService) {
        this.allowedCountries = config.getOrThrow<string[]>(
            "phone.allowedCountries",
        );
    }

    validate(value: unknown): boolean {
        if (typeof value !== "string" || !/^\+[1-9]\d{6,14}$/.test(value)) {
            return false;
        }

        const parsed = parsePhoneNumberFromString(value);

        return (
            !!parsed &&
            parsed.isValid() &&
            parsed.number === value &&
            !!parsed.country &&
            this.allowedCountries.includes(parsed.country)
        );
    }

    defaultMessage(args: ValidationArguments): string {
        return messageKey("validation.errors.invalidPhone", {
            property: args.property,
            countries: this.allowedCountries.join(", "),
        });
    }
}

export function IsE164Phone(validationOptions?: ValidationOptions) {
    return function (object: object, propertyName: string) {
        registerDecorator({
            target: object.constructor,
            propertyName,
            options: validationOptions,
            constraints: [],
            validator: IsE164PhoneConstraint,
        });
    };
}
