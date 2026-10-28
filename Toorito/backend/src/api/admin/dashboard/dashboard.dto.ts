import {
    AdminCustomerInput,
    AdminDeliveryPartnerInput,
    DashboardRangeInput,
} from "@modules/admin/admin.types";
import { PageQueryDto } from "@common/dto/page-query.dto";
import { OrderStatus, UserStatus } from "@prisma-client/enums";
import { Type } from "class-transformer";
import {
    IsDateString,
    IsEnum,
    IsIn,
    IsInt,
    IsOptional,
    IsString,
    MaxLength,
    Min,
} from "class-validator";

export class AdminCustomerQuery extends PageQueryDto implements AdminCustomerInput {
    @IsOptional()
    @IsString()
    @MaxLength(100)
    q?: string;
}

export class AdminDeliveryPartnerQuery extends PageQueryDto implements AdminDeliveryPartnerInput {
    @IsOptional()
    @IsString()
    @MaxLength(100)
    q?: string;

    @IsOptional()
    @IsEnum(UserStatus)
    status?: UserStatus;

    @IsOptional()
    @IsIn(["PENDING", "VERIFIED", "REJECTED"])
    kycStatus?: "PENDING" | "VERIFIED" | "REJECTED";
}

export class AdminOrderQuery extends PageQueryDto {
    @IsOptional()
    @IsString()
    @MaxLength(100)
    q?: string;

    @IsOptional()
    @IsDateString()
    from?: string;

    @IsOptional()
    @IsDateString()
    to?: string;

    @IsOptional()
    @IsEnum(OrderStatus)
    status?: OrderStatus;

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    storeId?: number;

    @IsOptional()
    @IsIn(["newest", "oldest", "total_desc", "total_asc"])
    sort?: "newest" | "oldest" | "total_desc" | "total_asc";
}

export class DashboardRangeQuery implements DashboardRangeInput {
    @IsOptional()
    @IsDateString()
    from?: string;

    @IsOptional()
    @IsDateString()
    to?: string;

    @IsOptional()
    @IsIn(["day", "week", "month"])
    group?: "day" | "week" | "month";
}

export class RecentActivityQuery extends PageQueryDto {}
