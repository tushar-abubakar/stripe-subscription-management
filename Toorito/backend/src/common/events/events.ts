import { Global, Injectable, Module } from "@nestjs/common";
import { Subject } from "rxjs";

export type AppEvent =
    | { type: "order.ready"; orderId: bigint; storeId: bigint }
    | { type: "order.cancelled"; orderId: bigint; storeId: bigint };

/** Tiny in-process bus to decouple Orders <-> Delivery without circular imports. */
@Injectable()
export class EventBus {
    readonly stream = new Subject<AppEvent>();
    emit(e: AppEvent) {
        this.stream.next(e);
    }
}

@Global()
@Module({ providers: [EventBus], exports: [EventBus] })
export class EventsModule {}
