import { AppConfig } from "@config/config.type";
import { Global, Injectable, Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

/**
 * A monetary value as returned by the API.
 *
 * Clients never need to guess the currency: the numeric `amount`, the ISO
 * `currency` code and the display `symbol` always travel together.
 */
export interface MoneyView {
    amount: number;
    currency: string;
    symbol: string;
    formatted: string;
}

/**
 * Single place that knows the platform currency.
 *
 * The default currency is configured with `DEFAULT_CURRENCY` (and optionally
 * `CURRENCY_SYMBOL`) and read through `ConfigService`. Amounts are stored in
 * the database as plain decimals; this service only shapes API output.
 */
@Injectable()
export class CurrencyService {
    readonly code: string;
    readonly symbol: string;
    readonly fractionDigits: number;

    private readonly formatter: Intl.NumberFormat;

    constructor(config: ConfigService) {
        const currency = config.getOrThrow<AppConfig["currency"]>("currency");

        this.code = currency.code;
        this.symbol = currency.symbol;
        this.fractionDigits = currency.fractionDigits;

        // Grouping/decimal rules only; the symbol is added by us so that a
        // configured CURRENCY_SYMBOL override is respected.
        this.formatter = new Intl.NumberFormat("en", {
            minimumFractionDigits: this.fractionDigits,
            maximumFractionDigits: this.fractionDigits,
        });
    }

    /** `{ code, symbol }` for envelopes such as "all amounts in this response". */
    get info(): { code: string; symbol: string } {
        return { code: this.code, symbol: this.symbol };
    }

    /**
     * Builds the price object for one amount.
     * Accepts numbers, numeric strings and Prisma Decimals; null/undefined become 0.
     */
    format(value: unknown): MoneyView {
        const amount = this.round(value);

        return {
            amount,
            currency: this.code,
            symbol: this.symbol,
            formatted: `${this.symbol}${this.formatter.format(amount)}`,
        };
    }

    /** Like {@link format} but keeps `null` for "no price". */
    formatOrNull(value: unknown): MoneyView | null {
        return value === null || value === undefined
            ? null
            : this.format(value);
    }

    /** Rounds to the currency's decimals (avoids 0.1 + 0.2 artefacts). */
    round(value: unknown): number {
        const number_ = value == null ? 0 : Number(value);

        if (!Number.isFinite(number_)) {
            return 0;
        }

        const factor = 10 ** this.fractionDigits;

        return Math.round((number_ + Number.EPSILON) * factor) / factor;
    }
}

@Global()
@Module({
    providers: [CurrencyService],
    exports: [CurrencyService],
})
export class CurrencyModule {}
