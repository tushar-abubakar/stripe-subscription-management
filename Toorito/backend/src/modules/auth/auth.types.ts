import { VehicleType } from "@prisma-client/enums";

/** Plain input types of the auth services (no decorators; the HTTP DTOs in src/api implement them). */


export interface SendOtpInput {
    phone: string;
}

export interface DeviceInput {
    deviceId?: string;
    deviceName?: string;
    platform?: string;
    appVersion?: string;
    pushToken?: string;
}

export interface CustomerVerifyOtpInput extends DeviceInput {
    phone: string;
    code: string;
    name?: string;
    guestToken?: string;
}

export interface DeliveryVerifyOtpInput extends DeviceInput {
    phone: string;
    code: string;
    name?: string;
    storeId?: number;
    vehicleType?: VehicleType;
    vehicleNumber?: string;
}

export interface StaffVerifyOtpInput extends DeviceInput {
    phone: string;
    code: string;
    name?: string;
    storeId?: number;
}

export type OtpVerifyDto =
    | CustomerVerifyOtpInput
    | DeliveryVerifyOtpInput
    | StaffVerifyOtpInput;

export interface ChallengeVerifyInput extends DeviceInput {
    challengeToken: string;
    code: string;
}
