import { ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsInt, IsOptional, Max, Min } from "class-validator";

/** Standard `?page=1&limit=20` pagination (limit is capped by `pageParams`). */
export class PageQueryDto {
    @ApiPropertyOptional({
        type: Number,
        minimum: 1,
        default: 1,
        description: "1-based page number",
    })
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    page?: number;

    @ApiPropertyOptional({
        type: Number,
        minimum: 1,
        maximum: 100,
        default: 20,
    })
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    @Max(100)
    limit?: number;
}
