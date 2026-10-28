import { PaymentsService } from "@modules/payments/payments.service";
import {
    BadRequestException,
    Headers,
    HttpCode,
    Param,
    Post,
    Req,
} from "@nestjs/common";
import { ApiHeader } from "@nestjs/swagger";
import { SkipThrottle } from "@nestjs/throttler";
import { I18nService } from "nestjs-i18n";
import { PublicController } from "./public-controller.decorator";

@PublicController("webhooks", "Webhooks")
export class PublicWebhooksController {
    constructor(
        private readonly payments: PaymentsService,
        private readonly i18n: I18nService,
    ) {}

    /** Gateway -> server. Needs the raw body for signature check (rawBody enabled in main.ts). */
    @SkipThrottle()
    @ApiHeader({
        name: "x-razorpay-signature",
        required: false,
        description: "Required for Razorpay webhooks",
    })
    @ApiHeader({
        name: "x-webhook-signature",
        required: false,
        description: "Required for generic webhook gateways",
    })
    @Post("payments/:gateway")
    @HttpCode(200)
    webhook(
        @Param("gateway") gateway: string,
        @Req() request: any,
        @Headers("x-razorpay-signature") razorpaySignature: string,
        @Headers("x-webhook-signature") genericSignature: string,
    ) {
        const normalizedGateway = gateway.toLowerCase();
        const signature =
            normalizedGateway === "razorpay"
                ? razorpaySignature
                : (genericSignature ?? razorpaySignature);
        if (!signature) {
            throw new BadRequestException(
                this.i18n.translate("payments.errors.webhookSignatureRequired"),
            );
        }
        return this.payments.handleWebhook(
            gateway,
            request.rawBody,
            signature,
            request.body,
        );
    }
}
