import { StoreScopeService } from "@common/authorization/store-scope.service";
import { Global, Module } from "@nestjs/common";

/**
 * Makes `StoreScopeService` injectable in every module
 * (controllers use it to resolve the store a request may act on).
 */
@Global()
@Module({
    providers: [StoreScopeService],
    exports: [StoreScopeService],
})
export class AuthorizationModule {}
