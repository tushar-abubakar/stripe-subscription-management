import { UserRole } from "@prisma-client/enums";

export type AuthUser = {
    id: bigint;
    role: UserRole;
    storeId: bigint | null;
    sid: string; // session id
    jti: string;
    exp: number;
};
