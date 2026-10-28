import {
    AuditLogListInput,
    AuthLogListInput,
    StockMovementListInput,
    TransactionLogListInput,
} from "@core/audit/audit.types";
import { PhoneField } from "@common/decorators/phone.decorator";
import { PageQueryDto } from "@common/dto/page-query.dto";
import {
    AuthEvent,
    StockMovementType,
    TransactionStatus,
} from "@prisma-client/enums";
import { Type } from "class-transformer";
import {
    IsDateString,
    IsEnum,
    IsInt,
    IsOptional,
    IsString,
    MaxLength,
    Min,
} from "class-validator";

export class AuditLogQuery extends PageQueryDto implements AuditLogListInput {
    @IsOptional()
    @IsString()
    @MaxLength(50)
    entityType?: string;

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    actorId?: number;

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    storeId?: number;

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
}

export class AuthLogQuery extends PageQueryDto implements AuthLogListInput {
    @IsOptional()
    @PhoneField()
    phone?: string;

    @IsOptional()
    @IsEnum(AuthEvent)
    event?: AuthEvent;
}

export class StockMovementQuery extends PageQueryDto implements StockMovementListInput {
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    storeId?: number;

    @IsOptional()
    @IsEnum(StockMovementType)
    type?: StockMovementType;
}

export class TransactionLogQuery extends PageQueryDto implements TransactionLogListInput {
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    orderId?: number;

    @IsOptional()
    @IsEnum(TransactionStatus)
    status?: TransactionStatus;
}
