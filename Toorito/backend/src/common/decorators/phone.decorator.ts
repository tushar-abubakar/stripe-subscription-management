import { messageKey } from "@common/utils/localeMessage.util";
import { IsE164Phone } from "@common/validators/is-e164-phone.validator";
import { applyDecorators } from "@nestjs/common";
import { Transform } from "class-transformer";
import {
    IsNotEmpty,
    ValidationArguments,
    ValidationOptions,
} from "class-validator";
import { parsePhoneNumberFromString } from "libphonenumber-js";

/**
 * Phone number field.
 *
 * - Trims the input and normalises "+91 98765-43210" to "+919876543210".
 * - Requires a valid E.164 number from an allowed country.
 */
export function PhoneField(validationOptions?: ValidationOptions) {
    return applyDecorators(
        Transform(({ value }) => {
            if (typeof value !== "string") {
                return value;
            }
            const parsed = parsePhoneNumberFromString(value.trim());
            return parsed ? parsed.number : value.trim();
        }),
        IsNotEmpty({
            message: (args: ValidationArguments) =>
                messageKey("validation.errors.NOT_EMPTY", {
                    property: args.property,
                }),
            ...validationOptions,
        }),
        IsE164Phone(validationOptions),
    );
}
