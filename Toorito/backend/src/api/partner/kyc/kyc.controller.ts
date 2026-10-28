import { Capability, CurrentUser } from "@common/decorators/auth.decorator";
import { AuthUser } from "@common/types/auth.type";
import { KycDocDto } from "../../store/kyc/kyc.dto";
import { KycService } from "@modules/kyc/kyc.service";
import { Body, Get, Post } from "@nestjs/common";
import { PartnerController } from "../partner-controller.decorator";

/** Endpoints used by the delivery partner app. */
@PartnerController("kyc", "KYC")
export class PartnerKycController {
    constructor(private readonly kyc: KycService) {}

    /** Same as GET /account/kyc (kept for existing apps). */
    @Get()
    getKyc(@CurrentUser() user: AuthUser) {
        return this.kyc.mine(user);
    }

    /** Same as POST /account/kyc (kept for existing apps): saved as a DRAFT — submit with POST /account/kyc/submit. */
    @Capability("KYC_UPDATE")
    @Post()
    submitKyc(@CurrentUser() user: AuthUser, @Body() dto: KycDocDto) {
        return this.kyc.add(user, dto);
    }
}
