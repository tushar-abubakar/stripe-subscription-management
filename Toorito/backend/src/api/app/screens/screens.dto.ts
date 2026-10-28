import { PLATFORMS } from "@modules/sdui/schema/contract";
import { PRODUCT_SORTS } from "@modules/sdui/schema/definitions";
import { ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import {
    IsIn,
    IsInt,
    IsNumber,
    IsOptional,
    IsString,
    Matches,
    Max,
    MaxLength,
    Min,
} from "class-validator";

/** Who is asking: sent on every SDUI request by the app. */
export class AppContextQuery {
    @ApiPropertyOptional({
        example: 7,
        description:
            "Store serving the user's location (GET /stores/resolve). Without it, data sections are empty.",
    })
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    storeId?: number;

    @ApiPropertyOptional({ enum: PLATFORMS, default: "android" })
    @IsOptional()
    @IsIn(PLATFORMS)
    platform?: (typeof PLATFORMS)[number];

    @ApiPropertyOptional({
        example: "1.4.0",
        default: "1.0.0",
        description:
            "App version: components / designs newer than this are never sent",
    })
    @IsOptional()
    @Matches(/^\d{1,3}\.\d{1,3}\.\d{1,4}$/)
    appVersion?: string;
}

export class ScreenQuery extends AppContextQuery {
    @ApiPropertyOptional({
        example: 8,
        description:
            "Keep this version (from `screen.version`), e.g. while paging after a publish",
    })
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    v?: number;
}

export class SectionQuery extends ScreenQuery {
    @ApiPropertyOptional({
        example: "eyJvIjoxMn0",
        description: "From `data.next`",
    })
    @IsOptional()
    @IsString()
    @MaxLength(200)
    cursor?: string;
}

/** Filters / sort a customer picks on a landing page (options come from the page's filter_bar). */
export class LandingQuery extends AppContextQuery {
    @ApiPropertyOptional({ enum: PRODUCT_SORTS })
    @IsOptional()
    @IsIn(PRODUCT_SORTS)
    sort?: string;

    @ApiPropertyOptional({
        example: "21",
        description: "Sub-category tab / category filter",
    })
    @IsOptional()
    @Matches(/^[0-9]{1,19}$/)
    categoryId?: string;

    @ApiPropertyOptional({ example: "4" })
    @IsOptional()
    @Matches(/^[0-9]{1,19}$/)
    brandId?: string;

    @ApiPropertyOptional({ example: 50 })
    @IsOptional()
    @Type(() => Number)
    @IsNumber()
    @Min(0)
    minPrice?: number;

    @ApiPropertyOptional({ example: 500 })
    @IsOptional()
    @Type(() => Number)
    @IsNumber()
    @Min(0)
    maxPrice?: number;

    @ApiPropertyOptional({ example: 25 })
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    @Max(90)
    minDiscountPct?: number;
}

export class LandingItemsQuery extends LandingQuery {
    @ApiPropertyOptional({ example: "eyJvIjoyMH0" })
    @IsOptional()
    @IsString()
    @MaxLength(200)
    cursor?: string;

    @ApiPropertyOptional({ example: 20, default: 20 })
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    @Max(50)
    limit?: number;
}
