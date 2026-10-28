import { toUrlSlug } from "@common/utils/helpers.util";
import { messageKey } from "@common/utils/localeMessage.util";
import { applyDecorators } from "@nestjs/common";
import { Transform } from "class-transformer";
import {
    IsNotEmpty,
    Matches,
    ValidationArguments,
    ValidationOptions,
} from "class-validator";

/**
 * Slug field.
 *
 * - Trims and normalises the input.
 * - Converts text to lowercase.
 * - Replaces non-alphanumeric characters with hyphens.
 * - Validates the resulting slug format.
 */
export function Slug(validationOptions?: ValidationOptions) {
    return applyDecorators(
        Transform(({ value }) =>
            typeof value === "string" ? toUrlSlug(value.trim()) : value,
        ),
        IsNotEmpty({
            message: (args: ValidationArguments) =>
                messageKey("validation.errors.NOT_EMPTY", {
                    property: args.property,
                }),
            ...validationOptions,
        }),
        Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
            message: (args: ValidationArguments) =>
                messageKey("validation.errors.INVALID_SLUG", {
                    property: args.property,
                }),
            ...validationOptions,
        }),
    );
}
