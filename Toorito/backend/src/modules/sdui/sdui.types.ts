/** Inputs of the SDUI services (plain types; HTTP DTOs live in src/api/admin/sdui). */
import { SduiGroupKind, SduiScreenKind } from "@prisma-client/enums";
import { I18nText } from "./schema/contract";

export interface ScreenListInput {
    q?: string;
    kind?: SduiScreenKind;
    state?:
        | "live"
        | "never_published"
        | "unpublished_changes"
        | "scheduled"
        | "inactive";
    page?: number;
    limit?: number;
}

export interface CreateScreenInput {
    key: string;
    kind: SduiScreenKind;
    title: I18nText;
    description?: I18nText;
    copyFrom?: { screenId: bigint; version?: number };
}

export interface UpdateScreenInput {
    title?: I18nText;
    description?: I18nText | null;
    isActive?: boolean;
}

export interface SaveDraftInput {
    layout: unknown;
    revision: number;
}

export interface PublishInput {
    note?: string;
    publishAt?: Date;
    /** false = variant for targeting / A-B rules only. */
    makeLive?: boolean;
    revision?: number;
}

export interface RuleInput {
    name: string;
    version: number;
    priority?: number;
    conditions?: Record<string, unknown>;
    startsAt?: Date | null;
    endsAt?: Date | null;
    isActive?: boolean;
}

export interface SectionInput {
    key: string;
    name: I18nText;
    node: unknown;
    isActive?: boolean;
}

export interface GroupInput {
    key: string;
    title: I18nText;
    subtitle?: I18nText | null;
    media?: Record<string, unknown> | null;
    kind: SduiGroupKind;
    items?: { type: "product" | "category" | "brand"; id: string }[];
    rule?: Record<string, unknown> | null;
    schedule?: Record<string, unknown> | null;
    landingScreenId?: bigint | null;
    landing?: Record<string, unknown> | null;
    isActive?: boolean;
}
