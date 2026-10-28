import {
    CreateTicketInput,
    MessageInput,
    StaffMessageInput,
    UpdateTicketInput,
    ResolveTicketInput,
    MyTicketsInput,
    TicketQueueInput,
    SupportSummaryInput,
} from "@modules/support/support.types";
import { PageQueryDto } from "@common/dto/page-query.dto";
import { ApiProperty, ApiPropertyOptional, OmitType } from "@nestjs/swagger";
import {
    TicketCategory,
    TicketPriority,
    TicketStatus,
} from "@prisma-client/enums";
import { Transform, Type } from "class-transformer";
import {
    ArrayMaxSize,
    IsArray,
    IsBoolean,
    IsDateString,
    IsEnum,
    IsIn,
    IsInt,
    IsOptional,
    IsString,
    MaxLength,
    Min,
    MinLength,
} from "class-validator";

/** Query-string booleans: "true" / "1" → true, "false" / "0" → false. */
const QueryBool = () =>
    Transform(({ value }) =>
        value === "true" || value === "1" || value === true
            ? true
            : value === "false" || value === "0" || value === false
              ? false
              : value,
    );

export class CreateTicketDto implements CreateTicketInput {
    @ApiProperty({ enum: TicketCategory })
    @IsEnum(TicketCategory)
    category: TicketCategory;

    @ApiProperty({ maxLength: 255 })
    @IsString()
    @MaxLength(255)
    subject: string;

    @ApiProperty({ maxLength: 5000 })
    @IsString()
    @MaxLength(5000)
    body: string;

    @ApiPropertyOptional({ type: Number, minimum: 1 })
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    orderId?: number;

    @ApiPropertyOptional({
        type: [Number],
        description: "Media IDs attached to the ticket (your own uploads, purpose SUPPORT, max 5)",
    })
    @IsOptional()
    @IsArray()
    @ArrayMaxSize(5)
    @Type(() => Number)
    @IsInt({ each: true })
    attachmentIds?: number[];
}

export class MessageDto implements MessageInput {
    @ApiProperty({ maxLength: 5000, example: "Sorry about the damaged eggs. We have refunded ৳120 to your wallet." })
    @IsString()
    @MaxLength(5000)
    body: string;

    @ApiPropertyOptional({
        type: [Number],
        description: "Media IDs attached to the message (your own uploads, purpose SUPPORT, max 5)",
        example: [9012],
    })
    @IsOptional()
    @IsArray()
    @ArrayMaxSize(5)
    @Type(() => Number)
    @IsInt({ each: true })
    attachmentIds?: number[];
}

/** Only support staff can mark a message as internal. */
export class StaffMessageDto extends MessageDto implements StaffMessageInput {
    @ApiPropertyOptional({
        type: Boolean,
        example: false,
        description:
            "Only staff may set this flag; internal messages are hidden from customers",
    })
    @IsOptional()
    @IsBoolean()
    isInternal?: boolean;
}

export class UpdateTicketDto implements UpdateTicketInput {
    @ApiPropertyOptional({ enum: TicketStatus, example: TicketStatus.IN_PROGRESS })
    @IsOptional()
    @IsEnum(TicketStatus)
    status?: TicketStatus;

    @ApiPropertyOptional({ enum: TicketPriority, example: TicketPriority.HIGH })
    @IsOptional()
    @IsEnum(TicketPriority)
    priority?: TicketPriority;

    @ApiPropertyOptional({
        type: Number,
        minimum: 1,
        example: 120,
        description: "Store manager: a manager / staff of the ticket's store. Admin: an admin or a member of the ticket's store.",
    })
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    assignedToId?: number;
}

/** Close the complaint with a customer-visible resolution note. */
export class ResolveTicketDto implements ResolveTicketInput {
    @ApiProperty({
        maxLength: 1000,
        example: "Refunded ৳120 to your wallet for the damaged eggs. Sorry for the trouble!",
        description: "Posted to the thread as a customer-visible message and stored on the ticket",
    })
    @IsString()
    @MinLength(1)
    @MaxLength(1000)
    resolution: string;

    @ApiPropertyOptional({ example: false, default: false, description: "true = CLOSED (no more replies), false = RESOLVED (customer may reopen by replying)" })
    @IsOptional()
    @IsBoolean()
    close?: boolean;

    @ApiPropertyOptional({ example: true, default: true, description: "Send an in-app notification to the customer" })
    @IsOptional()
    @IsBoolean()
    notifyCustomer?: boolean;
}

/** Customer / staff "my tickets" list. */
export class MyTicketsQuery extends PageQueryDto implements MyTicketsInput {}

/** Support queue filters (admins may also filter by store). */
export class TicketQueueQuery extends PageQueryDto implements TicketQueueInput {
    @ApiPropertyOptional({ enum: TicketStatus })
    @IsOptional()
    @IsEnum(TicketStatus)
    status?: TicketStatus;

    @ApiPropertyOptional({ enum: TicketPriority })
    @IsOptional()
    @IsEnum(TicketPriority)
    priority?: TicketPriority;

    @ApiPropertyOptional({ enum: TicketCategory })
    @IsOptional()
    @IsEnum(TicketCategory)
    category?: TicketCategory;

    @ApiPropertyOptional({ type: Number, example: 7 })
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    storeId?: number;

    @ApiPropertyOptional({ type: Number, example: 5501 })
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    orderId?: number;

    @ApiPropertyOptional({ type: Number, example: 120 })
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    assignedToId?: number;

    @ApiPropertyOptional({ type: Boolean, example: true, description: "Only tickets nobody is assigned to" })
    @IsOptional()
    @QueryBool()
    @IsBoolean()
    unassigned?: boolean;

    @ApiPropertyOptional({ type: Boolean, example: true, description: "true = only tickets a store escalated to the admin team; false = only not escalated" })
    @IsOptional()
    @QueryBool()
    @IsBoolean()
    escalated?: boolean;

    @ApiPropertyOptional({ example: "TK-MGZ", maxLength: 100, description: "Ticket number or subject" })
    @IsOptional()
    @IsString()
    @MaxLength(100)
    q?: string;

    @ApiPropertyOptional({ example: "2026-10-01", format: "date", description: "Created on / after (UTC day)" })
    @IsOptional()
    @IsDateString()
    from?: string;

    @ApiPropertyOptional({ example: "2026-10-20", format: "date", description: "Created on / before (UTC day, inclusive)" })
    @IsOptional()
    @IsDateString()
    to?: string;

    @ApiPropertyOptional({ enum: ["priority", "newest", "oldest", "last_message"], default: "priority" })
    @IsOptional()
    @IsIn(["priority", "newest", "oldest", "last_message"])
    sort?: "priority" | "newest" | "oldest" | "last_message";
}

/** Store managers only see their own store's queue, so `storeId` is not accepted. */
export class StoreTicketQueueQuery extends OmitType(TicketQueueQuery, [
    "storeId",
] as const) {}

/** `GET …/support/summary` date window (created date, UTC days). */
export class SupportSummaryQuery implements SupportSummaryInput {
    @ApiPropertyOptional({ example: "2026-10-01", format: "date", description: "Default: 30 days before `to`" })
    @IsOptional()
    @IsDateString()
    from?: string;

    @ApiPropertyOptional({ example: "2026-10-20", format: "date", description: "Default: today" })
    @IsOptional()
    @IsDateString()
    to?: string;
}

export class AdminSupportSummaryQuery extends SupportSummaryQuery {
    @ApiPropertyOptional({ type: Number, example: 7, description: "Omit for all stores" })
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    storeId?: number;
}

/** Store → admin team. */
export class EscalateTicketDto {
    @ApiProperty({ example: "Customer reports a repeated wrong item from the same supplier batch; needs a central decision", minLength: 5, maxLength: 1000 })
    @IsString()
    @MinLength(5)
    @MaxLength(1000)
    note: string;
}
