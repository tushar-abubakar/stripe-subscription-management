import { PageQueryDto } from "@common/dto/page-query.dto";
import {
    TicketCategory,
    TicketPriority,
    TicketStatus,
} from "@prisma-client/enums";

/** Plain input types of the support services (no decorators; the HTTP DTOs in src/api implement them). */


export interface CreateTicketInput {
    category: TicketCategory;
    subject: string;
    body: string;
    orderId?: number;
    attachmentIds?: number[];
}

export interface MessageInput {
    body: string;
    attachmentIds?: number[];
}

/** Only support staff can mark a message as internal. */
export interface StaffMessageInput extends MessageInput {
    isInternal?: boolean;
}

export interface UpdateTicketInput {
    status?: TicketStatus;
    priority?: TicketPriority;
    assignedToId?: number;
}

/** Close the complaint with a customer-visible resolution note. */
export interface ResolveTicketInput {
    resolution: string;
    close?: boolean;
    notifyCustomer?: boolean;
}

/** Customer / staff "my tickets" list. */
export interface MyTicketsInput extends PageQueryDto {
}

/** Support queue filters (admins may also filter by store). */
export interface TicketQueueInput extends PageQueryDto {
    status?: TicketStatus;
    priority?: TicketPriority;
    category?: TicketCategory;
    storeId?: number;
    orderId?: number;
    assignedToId?: number;
    unassigned?: boolean;
    escalated?: boolean;
    q?: string;
    from?: string;
    to?: string;
    sort?: "priority" | "newest" | "oldest" | "last_message";
}

/** `GET …/support/summary` date window (created date, UTC days). */
export interface SupportSummaryInput {
    from?: string;
    to?: string;
}
