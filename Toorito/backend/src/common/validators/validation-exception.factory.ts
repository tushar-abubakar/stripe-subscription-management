import { messageKey, parseMessageKey } from "@common/utils/localeMessage.util";
import { BadRequestException, ValidationError } from "@nestjs/common";

/**
 * Converts a class-validator constraint name into a translation key.
 *
 * isInt -> INT, minLength -> MIN_LENGTH, arrayMinSize -> ARRAY_MIN_SIZE,
 * whitelistValidation -> WHITELIST_VALIDATION.
 */
const constraintToKey = (constraint: string): string =>
    constraint
        .replace(/^is(?=[A-Z])/, "")
        .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
        .toUpperCase();

/** Collects `{ key, args }` messages for a validation error and all its children. */
const collectMessages = (
    error: ValidationError,
    parentPath: string,
    output: string[],
): void => {
    const path = parentPath
        ? `${parentPath}.${error.property}`
        : error.property;

    for (const [constraint, message] of Object.entries(
        error.constraints ?? {},
    )) {
        // Custom validators already return a translation envelope.
        if (parseMessageKey(message)) {
            output.push(message);
            continue;
        }

        output.push(
            messageKey(`validation.errors.${constraintToKey(constraint)}`, {
                property: path,
                // Numeric limits such as "must be longer than 8 characters".
                constraints: (message.match(/-?\d+(?:\.\d+)?/g) ?? []).slice(
                    0,
                    2,
                ),
            }),
        );
    }

    for (const child of error.children ?? []) {
        collectMessages(child, path, output);
    }
};

/**
 * `ValidationPipe({ exceptionFactory })` implementation.
 *
 * Produces a 400 whose `message` is an array of translation envelopes. The
 * global exception filter translates them with `I18nService.translate()`, so
 * every built-in class-validator decorator is localised without having to pass
 * a message to each decorator in each DTO.
 */
export const validationExceptionFactory = (
    errors: ValidationError[],
): BadRequestException => {
    const messages: string[] = [];

    for (const error of errors) {
        collectMessages(error, "", messages);
    }

    return new BadRequestException(messages);
};
