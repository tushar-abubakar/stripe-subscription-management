import { BadRequestException, Injectable, PipeTransform } from "@nestjs/common";
import { I18nService } from "nestjs-i18n";

/** Converts a numeric path/query id (max 18 digits) into a `bigint`. */
@Injectable()
export class ParseBigIntPipe implements PipeTransform<string, bigint> {
    constructor(private readonly i18n: I18nService) {}

    transform(value: string): bigint {
        if (!/^\d{1,18}$/.test(String(value))) {
            throw new BadRequestException(
                this.i18n.translate("common.errors.invalidId"),
            );
        }

        return BigInt(value);
    }
}
