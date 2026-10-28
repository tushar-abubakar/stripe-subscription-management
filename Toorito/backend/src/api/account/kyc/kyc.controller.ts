import {
    Capability,
    CurrentUser,
    Roles,
} from "@common/decorators/auth.decorator";
import { AuthUser } from "@common/types/auth.type";
import { ParseBigIntPipe } from "@core/http/pipes/parse-bigint.pipe";
import { KycDocDto, KycRemovalDto } from "../../store/kyc/kyc.dto";
import { KycService } from "@modules/kyc/kyc.service";
import {
    ApiAddMyKyc,
    ApiDeleteMyKyc,
    ApiSubmitMyKyc,
    ApiKycRemoval,
    ApiMyKyc,
} from "../../store/kyc/kyc.swagger";
import { Body, Delete, Get, HttpCode, Param, Post } from "@nestjs/common";
import { UserRole } from "@prisma-client/enums";
import { AccountController } from "../account-controller.decorator";

/** Staff / delivery partner: own documents. */
@Roles(UserRole.STORE_STAFF, UserRole.DELIVERY_PARTNER)
@AccountController(
    "kyc",
    "My KYC",
    "Only store staff and delivery partners have KYC",
)
export class AccountKycController {
    constructor(private readonly kyc: KycService) {}

    @ApiMyKyc()
    @Get()
    mine(@CurrentUser() user: AuthUser) {
        return this.kyc.mine(user);
    }

    @Capability("KYC_UPDATE")
    @ApiAddMyKyc()
    @Post()
    @HttpCode(200)
    add(@CurrentUser() user: AuthUser, @Body() dto: KycDocDto) {
        return this.kyc.add(user, dto);
    }

    @Capability("KYC_UPDATE")
    @ApiSubmitMyKyc()
    @Post("submit")
    @HttpCode(200)
    submit(@CurrentUser() user: AuthUser) {
        return this.kyc.submit(user);
    }

    @Capability("KYC_UPDATE")
    @ApiDeleteMyKyc()
    @Delete(":id")
    remove(
        @CurrentUser() user: AuthUser,
        @Param("id", ParseBigIntPipe) id: bigint,
    ) {
        return this.kyc.removeDraft(user, id);
    }

    @ApiKycRemoval()
    @Post(":id/removal-request")
    @HttpCode(200)
    removal(
        @CurrentUser() user: AuthUser,
        @Param("id", ParseBigIntPipe) id: bigint,
        @Body() dto: KycRemovalDto,
    ) {
        return this.kyc.requestRemoval(user, id, dto.note);
    }
}
