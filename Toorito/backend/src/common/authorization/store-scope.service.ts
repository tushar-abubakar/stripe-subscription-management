import { AuthUser } from "@common/types/auth.type";
import { ForbiddenException, Injectable } from "@nestjs/common";
import { UserRole } from "@prisma-client/enums";
import { I18nService } from "nestjs-i18n";

@Injectable()
export class StoreScopeService {
    constructor(private readonly i18n: I18nService) {}

    scope(user: AuthUser, requested?: bigint | null): bigint {
        if (
            user.role === UserRole.ADMIN ||
            user.role === UserRole.SUPER_ADMIN
        ) {
            if (!requested) {
                throw new ForbiddenException(
                    this.i18n.translate("authorization.errors.storeIdRequired"),
                );
            }

            return requested;
        }

        if (!user.storeId) {
            throw new ForbiddenException(
                this.i18n.translate("authorization.errors.noStoreAssigned"),
            );
        }

        if (requested && requested !== user.storeId) {
            throw new ForbiddenException(
                this.i18n.translate("authorization.errors.outsideStore"),
            );
        }

        return user.storeId;
    }
}
