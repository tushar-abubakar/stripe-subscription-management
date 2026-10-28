import {
    SendOtpInput,
    DeviceInput,
    CustomerVerifyOtpInput,
    DeliveryVerifyOtpInput,
    StaffVerifyOtpInput,
    ChallengeVerifyInput,
} from "@modules/auth/auth.types";
import { PhoneField } from "@common/decorators/phone.decorator";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { VehicleType } from "@prisma-client/enums";
import { Type } from "class-transformer";
import {
    IsEnum,
    IsInt,
    IsOptional,
    IsString,
    Length,
    MaxLength,
    MinLength,
} from "class-validator";

export class SendOtpDto implements SendOtpInput {
    @PhoneField()
    @ApiProperty({
        description: "Phone number in international E.164 format",
        example: "+14155552671",
    })
    phone: string;
}

export class DeviceDto implements DeviceInput {
    @IsOptional()
    @IsString()
    @MaxLength(100)
    @ApiPropertyOptional({
        description: "Stable client device identifier",
        example: "device-8f31a2",
    })
    deviceId?: string;

    @IsOptional()
    @IsString()
    @MaxLength(120)
    @ApiPropertyOptional({
        description: "Human-readable device name",
        example: "MacBook Pro",
    })
    deviceName?: string;

    @IsOptional()
    @IsString()
    @MaxLength(20)
    @ApiPropertyOptional({ description: "Client platform", example: "web" })
    platform?: string;

    @IsOptional()
    @IsString()
    @MaxLength(20)
    @ApiPropertyOptional({
        description: "Client application version",
        example: "1.0.0",
    })
    appVersion?: string;

    @IsOptional()
    @IsString()
    @MaxLength(512)
    @ApiPropertyOptional({
        description: "Push-notification token for this device",
        example: "fcm-or-web-push-token",
    })
    pushToken?: string;
}

export class CustomerVerifyOtpDto extends DeviceDto implements CustomerVerifyOtpInput {
    @PhoneField()
    @ApiProperty({
        description: "Phone number in international E.164 format",
        example: "+14155552671",
    })
    phone: string;

    @IsString()
    @Length(6, 6)
    @ApiProperty({
        description: "Six-digit one-time password",
        example: "123456",
        minLength: 6,
        maxLength: 6,
    })
    code: string;

    @IsOptional()
    @IsString()
    @MaxLength(120)
    @ApiPropertyOptional({
        description: "Name used when creating a new account",
        example: "Alex Morgan",
        maxLength: 120,
    })
    name?: string;

    @IsOptional()
    @IsString()
    @MaxLength(64)
    @ApiPropertyOptional({
        description: "Guest cart token to merge into the customer account",
        example: "guest-cart-token",
    })
    guestToken?: string;
}

export class DeliveryVerifyOtpDto extends DeviceDto implements DeliveryVerifyOtpInput {
    @PhoneField()
    @ApiProperty({
        description: "Phone number in international E.164 format",
        example: "+14155552671",
    })
    phone: string;

    @IsString()
    @Length(6, 6)
    @ApiProperty({
        description: "Six-digit one-time password",
        example: "123456",
        minLength: 6,
        maxLength: 6,
    })
    code: string;

    @IsOptional()
    @IsString()
    @MaxLength(120)
    @ApiPropertyOptional({
        description: "Name used when creating a new account",
        example: "Alex Morgan",
        maxLength: 120,
    })
    name?: string;

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @ApiPropertyOptional({
        description:
            "Store identifier used to associate the staff member or delivery partner",
        example: 42,
        type: Number,
    })
    storeId?: number;

    @IsOptional()
    @IsEnum(VehicleType)
    @ApiPropertyOptional({
        description: "Delivery vehicle type",
        enum: VehicleType,
        example: Object.values(VehicleType)[0],
    })
    vehicleType?: VehicleType;

    @IsOptional()
    @IsString()
    @MaxLength(20)
    @ApiPropertyOptional({
        description: "Delivery vehicle registration number",
        example: "PB10AB1234",
        maxLength: 20,
    })
    vehicleNumber?: string;
}

export class StaffVerifyOtpDto extends DeviceDto implements StaffVerifyOtpInput {
    @PhoneField()
    @ApiProperty({
        description: "Phone number in international E.164 format",
        example: "+14155552671",
    })
    phone: string;

    @IsString()
    @Length(6, 6)
    @ApiProperty({
        description: "Six-digit one-time password",
        example: "123456",
        minLength: 6,
        maxLength: 6,
    })
    code: string;

    @IsOptional()
    @IsString()
    @MaxLength(120)
    @ApiPropertyOptional({
        description: "Name used when creating a new account",
        example: "Alex Morgan",
        maxLength: 120,
    })
    name?: string;

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @ApiPropertyOptional({
        description:
            "Store identifier used to associate the staff member or delivery partner",
        example: 42,
        type: Number,
    })
    storeId?: number;
}

export class PasswordLoginDto {
    @PhoneField()
    @ApiProperty({
        description: "Phone number in international E.164 format",
        example: "+14155552671",
    })
    phone: string;

    @IsString()
    @MinLength(8)
    @MaxLength(100)
    @ApiProperty({
        description: "Account password",
        example: "ExamplePassword123!",
        minLength: 8,
        maxLength: 100,
        format: "password",
    })
    password: string;
}

export class ChallengeVerifyDto extends DeviceDto implements ChallengeVerifyInput {
    @IsString()
    @ApiProperty({
        description: "Short-lived token returned by the password-login step",
        example: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.challenge",
    })
    challengeToken: string;

    @IsString()
    @Length(6, 6)
    @ApiProperty({
        description: "Six-digit one-time password",
        example: "123456",
        minLength: 6,
        maxLength: 6,
    })
    code: string;
}

export class RefreshDto {
    @IsString()
    @ApiProperty({
        description:
            "Refresh token from the previous successful login or refresh",
        example: "example-refresh-token",
    })
    refreshToken: string;

    @IsOptional()
    @IsString()
    @ApiPropertyOptional({
        description: "Push-notification token for this device",
        example: "fcm-or-web-push-token",
    })
    pushToken?: string;
}
