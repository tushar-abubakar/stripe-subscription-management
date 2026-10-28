import { AdminService } from "./admin.service";
import { DeliveryModule } from "@modules/delivery/delivery.module";
import { Module } from "@nestjs/common";

@Module({
    imports: [DeliveryModule],
    providers: [AdminService],
    exports: [AdminService],
})
export class AdminModule {}
