import { PageQueryDto } from "@common/dto/page-query.dto";
import { OptionValueType } from "@prisma-client/enums";

/** Plain input types of the option services (no decorators; the HTTP DTOs in src/api implement them). */


export const OPTION_SORTS = [
    "id_desc",
    "id_asc",
    "code_desc",
    "code_asc",
] as const;

export type OptionSort = (typeof OPTION_SORTS)[number];

export interface OptionListInput extends PageQueryDto {
    q?: string;
    excludeIds?: bigint[];
    sort?: OptionSort;
}

export interface OptionGroupInput {
    name: Record<string, string>;
    code?: string;
    valueType?: OptionValueType;
    isFilterable?: boolean;
    values?: OptionValueInput[];
}

export interface OptionValueInput {
    code?: string;
    label: Record<string, string>;
    swatch?: string;
    imageId?: bigint;
    position?: number;
}
