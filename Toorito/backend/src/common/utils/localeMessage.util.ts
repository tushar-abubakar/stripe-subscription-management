/**
 * Translatable message envelope.
 *
 * Code that cannot inject `I18nService` (class-validator constraints, pipes
 * created outside the DI container, storage drivers) throws a message built
 * with {@link messageKey}. The global `AllExceptionsFilter` turns the envelope
 * into the translated text for the caller's language using
 * `I18nService.translate()`.
 */
export interface MessageEnvelope {
    key: string;
    args?: Record<string, unknown>;
}

/** Serialises a translation key (+ arguments) into an exception message. */
export const messageKey = (
    key: string,
    args?: Record<string, unknown>,
): string => JSON.stringify({ key, args } satisfies MessageEnvelope);

/** Parses a message created by {@link messageKey}; returns null for plain text. */
export const parseMessageKey = (message: unknown): MessageEnvelope | null => {
    if (typeof message !== "string" || !message.startsWith("{")) {
        return null;
    }

    try {
        const parsed = JSON.parse(message) as Partial<MessageEnvelope>;

        return typeof parsed?.key === "string"
            ? { key: parsed.key, args: parsed.args }
            : null;
    } catch {
        return null;
    }
};
