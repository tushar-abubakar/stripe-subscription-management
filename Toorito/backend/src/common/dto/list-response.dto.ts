import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

export class ListResponseDto {
    @ApiProperty({ type: [Object] })
    items: any[];

    @ApiProperty()
    total: number;

    @ApiProperty({ minimum: 1 })
    page: number;

    @ApiProperty({ minimum: 1 })
    limit: number;
}

export class CursorListResponseDto extends ListResponseDto {
    @ApiPropertyOptional({ nullable: true })
    nextCursor?: string | null;
}
