import { OPTION_SORTS } from "@modules/catalog/option/option.types";
import { P } from "@common/authorization/permissions";
import { Permissions } from "@common/decorators/auth.decorator";
import { ParseBigIntPipe } from "@core/http/pipes/parse-bigint.pipe";
import { OptionGroupDto, OptionListQuery, OptionValueDto } from "./option.dto";
import { OptionService } from "@modules/catalog/option/option.service";
import {
    OPTION_SWAGGER_EXAMPLES as EX,
    OPTION_SWAGGER_ERRORS,
} from "./option.swagger";
import { Body, Delete, Get, Param, Post, Put, Query } from "@nestjs/common";
import {
    ApiBadRequestResponse,
    ApiBody,
    ApiConflictResponse,
    ApiCreatedResponse,
    ApiNotFoundResponse,
    ApiOkResponse,
    ApiOperation,
    ApiParam,
    ApiQuery,
} from "@nestjs/swagger";
import { AdminController } from "../admin-controller.decorator";

@ApiBadRequestResponse(OPTION_SWAGGER_ERRORS.badRequest)
@AdminController("catalog/options", "Options")
export class AdminOptionsController {
    constructor(private readonly options: OptionService) {}

    @Permissions(P.OPTION_READ)
    @Get()
    @ApiOperation({
        summary: "List option groups",
        description:
            "Returns paginated option groups and their values. Search supports option codes and localized names or labels.",
    })
    @ApiQuery({
        name: "page",
        required: false,
        type: Number,
        example: 1,
        description: "Page number",
    })
    @ApiQuery({
        name: "limit",
        required: false,
        type: Number,
        example: 20,
        description: "Number of records per page",
    })
    @ApiQuery({
        name: "q",
        required: false,
        type: String,
        example: "color",
        description: "Search by option group or option value code/name",
    })
    @ApiQuery({
        name: "excludeIds",
        required: false,
        type: [String],
        example: ["15", "20"],
        description: "Option group IDs to exclude",
    })
    @ApiQuery({
        name: "sort",
        required: false,
        enum: OPTION_SORTS,
        example: "id_desc",
        description: "Sort order",
    })
    @ApiOkResponse({
        description: "Paginated option group list",
        schema: {
            example: EX.paginatedGroupsResponse,
        },
    })
    list(@Query() query: OptionListQuery) {
        return this.options.listOptionGroups(query);
    }

    @Permissions(P.OPTION_READ)
    @Get(":id")
    @ApiOperation({
        summary: "Get an option group",
        description: "Returns one option group and its ordered values.",
    })
    @ApiParam({
        name: "id",
        type: String,
        example: "12",
        description: "Option group BigInt ID",
    })
    @ApiOkResponse({
        description: "Option group retrieved successfully",
        schema: {
            example: EX.groupResponse,
        },
    })
    @ApiNotFoundResponse(OPTION_SWAGGER_ERRORS.notFound)
    get(@Param("id", ParseBigIntPipe) id: bigint) {
        return this.options.getOptionGroup(id);
    }

    @Permissions(P.OPTION_READ)
    @Get(":id/values")
    @ApiOperation({
        summary: "List values in an option group",
        description: "Returns the option values ordered by position and ID.",
    })
    @ApiParam({
        name: "id",
        type: String,
        example: "12",
        description: "Parent option group BigInt ID",
    })
    @ApiOkResponse({
        description: "Option values retrieved successfully",
        schema: {
            type: "array",
            items: { type: "object" },
            example: EX.valuesResponse,
        },
    })
    @ApiNotFoundResponse(OPTION_SWAGGER_ERRORS.notFound)
    values(@Param("id", ParseBigIntPipe) id: bigint) {
        return this.options.listOptionValues(id);
    }

    @Permissions(P.OPTION_WRITE)
    @Post()
    @ApiOperation({
        summary: "Create an option group",
        description:
            "Creates an option group and optionally creates or upserts its initial values. `code` is optional for the group and its values; when omitted it is generated from the default-language name/label (a numeric suffix is added if the group code is taken). Values omitted from later update requests are not automatically deleted.",
    })
    @ApiBody({
        type: OptionGroupDto,
        description: "Option group fields and optional initial values",
        examples: {
            createColor: {
                summary: "Create a color option group",
                value: EX.createGroupBody,
            },
        },
    })
    @ApiCreatedResponse({
        description: "Option group created successfully",
        schema: {
            example: {
                id: "12",
                code: "COLOR",
                name: { en: "Color", hi: "रंग", pa: "ਰੰਗ" },
                valueType: "TEXT",
                isFilterable: true,
            },
        },
    })
    @ApiConflictResponse(OPTION_SWAGGER_ERRORS.conflict)
    create(@Body() dto: OptionGroupDto) {
        return this.options.upsertOptionGroup(dto);
    }

    @Permissions(P.OPTION_UPDATE)
    @Put(":id")
    @ApiOperation({
        summary: "Update an option group",
        description:
            "Updates an existing group. The code is not changed by this endpoint. Supplied values are upserted by code; omitted values remain unchanged.",
    })
    @ApiParam({
        name: "id",
        type: String,
        example: "12",
        description: "Option group BigInt ID",
    })
    @ApiBody({
        type: OptionGroupDto,
        description:
            "Updated group fields. Values are optional and are upserted when provided.",
        examples: {
            updateColor: {
                summary: "Update color group",
                value: EX.updateGroupBody,
            },
        },
    })
    @ApiOkResponse({
        description: "Option group updated successfully",
        schema: {
            example: {
                id: "12",
                code: "COLOR",
                name: {
                    en: "Product Color",
                    hi: "उत्पाद का रंग",
                    pa: "ਉਤਪਾਦ ਦਾ ਰੰਗ",
                },
                valueType: "TEXT",
                isFilterable: true,
            },
        },
    })
    @ApiNotFoundResponse(OPTION_SWAGGER_ERRORS.notFound)
    @ApiConflictResponse(OPTION_SWAGGER_ERRORS.conflict)
    update(
        @Param("id", ParseBigIntPipe) id: bigint,
        @Body() dto: OptionGroupDto,
    ) {
        return this.options.upsertOptionGroup(dto, id);
    }

    @Permissions(P.OPTION_WRITE)
    @Delete(":id")
    @ApiOperation({
        summary: "Delete an option group",
        description:
            "Deletes the group and its values. Deletion is rejected if a product or variant uses the group.",
    })
    @ApiParam({
        name: "id",
        type: String,
        example: "12",
        description: "Option group BigInt ID",
    })
    @ApiOkResponse({
        description: "Option group deleted successfully",
        schema: {
            example: EX.deleteResponse,
        },
    })
    @ApiNotFoundResponse(OPTION_SWAGGER_ERRORS.notFound)
    @ApiConflictResponse(OPTION_SWAGGER_ERRORS.conflict)
    remove(@Param("id", ParseBigIntPipe) id: bigint) {
        return this.options.deleteOptionGroup(id);
    }

    @Permissions(P.OPTION_WRITE)
    @Post(":id/values")
    @ApiOperation({
        summary: "Create an option value",
        description:
            "Creates a value belonging to the specified option group. When `code` is omitted it is generated from the default-language label, with a numeric suffix (e.g. RED_2) if the code is already used in the group.",
    })
    @ApiParam({
        name: "id",
        type: String,
        example: "12",
        description: "Parent option group BigInt ID",
    })
    @ApiBody({
        type: OptionValueDto,
        description: "Option value fields",
        examples: {
            createRed: {
                summary: "Create a red color value",
                value: EX.createValueBody,
            },
        },
    })
    @ApiCreatedResponse({
        description: "Option value created successfully",
        schema: {
            example: EX.value,
        },
    })
    @ApiNotFoundResponse(OPTION_SWAGGER_ERRORS.notFound)
    @ApiConflictResponse(OPTION_SWAGGER_ERRORS.conflict)
    createValue(
        @Param("id", ParseBigIntPipe) id: bigint,
        @Body() dto: OptionValueDto,
    ) {
        return this.options.upsertOptionValue(id, dto);
    }

    @Permissions(P.OPTION_WRITE)
    @Put(":id/values/:valueId")
    @ApiOperation({
        summary: "Update an option value",
        description:
            "Updates a value belonging to the specified option group. The value ID must belong to the parent group. When `code` is omitted the existing code is kept.",
    })
    @ApiParam({
        name: "id",
        type: String,
        example: "12",
        description: "Parent option group BigInt ID",
    })
    @ApiParam({
        name: "valueId",
        type: String,
        example: "101",
        description: "Option value BigInt ID",
    })
    @ApiBody({
        type: OptionValueDto,
        description: "Updated option value fields",
        examples: {
            updateRed: {
                summary: "Update a red color value",
                value: EX.updateValueBody,
            },
        },
    })
    @ApiOkResponse({
        description: "Option value updated successfully",
        schema: {
            example: {
                ...EX.value,
                code: "DARK_RED",
                label: {
                    en: "Dark Red",
                    hi: "गहरा लाल",
                    pa: "ਗੂੜ੍ਹਾ ਲਾਲ",
                },
                swatch: "#8B0000",
                position: 2,
            },
        },
    })
    @ApiNotFoundResponse(OPTION_SWAGGER_ERRORS.notFound)
    @ApiConflictResponse(OPTION_SWAGGER_ERRORS.conflict)
    updateValue(
        @Param("id", ParseBigIntPipe) id: bigint,
        @Param("valueId", ParseBigIntPipe) valueId: bigint,
        @Body() dto: OptionValueDto,
    ) {
        return this.options.upsertOptionValue(id, dto, valueId);
    }

    @Permissions(P.OPTION_WRITE)
    @Delete(":id/values/:valueId")
    @ApiOperation({
        summary: "Delete an option value",
        description:
            "Deletes an option value. Deletion is rejected if a variant uses it.",
    })
    @ApiParam({
        name: "id",
        type: String,
        example: "12",
        description: "Parent option group BigInt ID",
    })
    @ApiParam({
        name: "valueId",
        type: String,
        example: "101",
        description: "Option value BigInt ID",
    })
    @ApiOkResponse({
        description: "Option value deleted successfully",
        schema: {
            example: EX.deleteResponse,
        },
    })
    @ApiNotFoundResponse(OPTION_SWAGGER_ERRORS.notFound)
    @ApiConflictResponse(OPTION_SWAGGER_ERRORS.conflict)
    removeValue(
        @Param("id", ParseBigIntPipe) id: bigint,
        @Param("valueId", ParseBigIntPipe) valueId: bigint,
    ) {
        return this.options.deleteOptionValue(id, valueId);
    }
}
