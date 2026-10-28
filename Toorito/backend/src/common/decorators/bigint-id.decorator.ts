import { messageKey } from "@common/utils/localeMessage.util";
import { applyDecorators } from "@nestjs/common";
import { ApiProperty } from "@nestjs/swagger";
import { Transform } from "class-transformer";
import {
    ArrayMaxSize,
    IsArray,
    ValidationArguments,
    ValidationOptions,
    registerDecorator,
} from "class-validator";

/**
 * JSON has no bigint, so clients send ids as numeric strings ("123") or as
 * safe-integer numbers. Anything else is passed through unchanged so
 * `IsBigIntId` rejects it with a proper 400.
 */
const toBigInt = ({ value }: { value: unknown }) => {
    if (typeof value === "bigint") return value;
    if (typeof value === "number" && Number.isSafeInteger(value)) {
        return BigInt(value);
    }
    if (typeof value === "string" && /^\d+$/.test(value.trim())) {
        return BigInt(value.trim());
    }
    return value;
};

/** Validates a positive bigint (after the transform above). */
function IsPositiveBigInt(options?: ValidationOptions): PropertyDecorator {
    return (target, propertyKey) =>
        registerDecorator({
            name: "isPositiveBigInt",
            target: target.constructor,
            propertyName: propertyKey as string,
            options: {
                message: (args: ValidationArguments) =>
                    messageKey("validation.errors.POSITIVE_BIGINT", {
                        property: args.property,
                    }),
                ...options,
            },
            validator: {
                validate: (value: unknown) =>
                    typeof value === "bigint" && value > BigInt(0),
            },
        });
}

/**
 * Bigint id field: accepts `123` or `"123"`, exposes `bigint` on the DTO.
 * Combine with `@IsOptional()` for optional ids.
 */
export function IsBigIntId(options?: ValidationOptions) {
    return applyDecorators(
        ApiProperty({ type: String, example: "1" }),
        Transform(toBigInt),
        IsPositiveBigInt(options),
    );
}

/**
 * Accepts `?ids=1&ids=2`, `?ids=1,2`, or a JSON array of numbers/strings.
 * Items are converted with the same rules as `toBigInt`; anything invalid is
 * left as-is so `IsPositiveBigIntArray` rejects it with a 400.
 */
const toBigIntArray = ({ value }: { value: unknown }) => {
    if (value == null) return value;
    const list = Array.isArray(value)
        ? value
        : typeof value === "string"
          ? value.split(",")
          : [value];
    return list
        .filter((v) => !(typeof v === "string" && v.trim() === ""))
        .map((v) => toBigInt({ value: v }));
};

/** Validates an array where every item is a positive bigint. */
function IsPositiveBigIntArray(options?: ValidationOptions): PropertyDecorator {
    return (target, propertyKey) =>
        registerDecorator({
            name: "isPositiveBigIntArray",
            target: target.constructor,
            propertyName: propertyKey as string,
            options: {
                message: (args: ValidationArguments) =>
                    messageKey("validation.errors.POSITIVE_BIGINT", {
                        property: args.property,
                    }),
                ...options,
            },
            validator: {
                validate: (value: unknown) =>
                    Array.isArray(value) &&
                    value.every((v) => typeof v === "bigint" && v > BigInt(0)),
            },
        });
}

/**
 * Bigint id array field: exposes `bigint[]` on the DTO.
 * Combine with `@IsOptional()` for optional lists.
 */
export function IsBigIntArray(options?: ValidationOptions & { max?: number }) {
    const { max = 100, ...validationOptions } = options ?? {};
    return applyDecorators(
        ApiProperty({
            type: [String],
            example: ["1", "2"],
            description: "Repeated (`?ids=1&ids=2`) or comma separated.",
        }),
        Transform(toBigIntArray),
        IsArray(validationOptions),
        ArrayMaxSize(max, validationOptions),
        IsPositiveBigIntArray(validationOptions),
    );
}
