import { CurrencyService } from "@core/currency/currency.service";
import { LocaleService } from "@core/locale/locale.service";
import { ResolveQueryDto } from "../../admin/stores/stores.dto";
import { StoresService } from "@modules/stores/stores.service";
import { ApiResolveStore } from "../../admin/stores/stores.swagger";
import {
    ChargeCalc,
    chargesOf,
    isChargeLive,
} from "@modules/stores/stores.util";
import { Get, NotFoundException, Query } from "@nestjs/common";
import { I18nLang, I18nService } from "nestjs-i18n";
import { AppController } from "../app-controller.decorator";

export type PublicStore = NonNullable<
    Awaited<ReturnType<StoresService["resolve"]>>
>;

/** Public storefront: which store serves a location (customers + guests). */
@AppController("stores", "Stores")
export class AppStoresController {
    constructor(
        private readonly stores: StoresService,
        private readonly currency: CurrencyService,
        private readonly locale: LocaleService,
        private readonly i18n: I18nService,
    ) {}

    @ApiResolveStore()
    @Get("resolve")
    async resolve(@Query() query: ResolveQueryDto, @I18nLang() lang: string) {
        const store = await this.stores.resolve(query.lat, query.lng);

        if (!store) {
            throw new NotFoundException({
                message: this.i18n.translate("stores.errors.notServiceable"),
                code: "NOT_SERVICEABLE",
            });
        }

        return this.present(store, lang);
    }

    /** Localizes the name, formats money and lists the surcharges live right now. */
    private present(store: PublicStore, lang: string) {
        const money = (value: unknown) => this.currency.formatOrNull(value);
        const { charges, ...rest } = store;

        return {
            ...rest,
            name: this.locale.pick(store.name, lang),
            currency: this.currency.info,
            minOrderValue: money(store.minOrderValue),
            deliveryFee: money(store.deliveryFee),
            freeDeliveryAbove: money(store.freeDeliveryAbove),
            handlingFee: money(store.handlingFee),
            smallCartLimit: money(store.smallCartLimit),
            smallCartFee: money(store.smallCartFee),
            surcharges: chargesOf(charges)
                .filter((charge) => isChargeLive(charge, store.timezone))
                .map((charge) => ({
                    id: charge.id,
                    kind: charge.kind,
                    label: charge.label
                        ? this.locale.pick(charge.label, lang)
                        : null,
                    calc: charge.calc,
                    amount:
                        charge.calc === ChargeCalc.PERCENT
                            ? charge.amount
                            : money(charge.amount),
                    maxAmount: money(charge.maxAmount),
                })),
        };
    }
}
