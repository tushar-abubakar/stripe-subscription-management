import { AuthUser } from "@common/types/auth.type";
import { PrismaService } from "@core/database/prisma.service";
import { RedisService } from "@core/redis/redis.service";
import { TokenService } from "@core/auth/token.service";
import { DeliveryService } from "@modules/delivery/delivery.service";
import { Logger } from "@nestjs/common";
import {
    ConnectedSocket,
    MessageBody,
    OnGatewayConnection,
    SubscribeMessage,
    WebSocketGateway,
    WebSocketServer,
} from "@nestjs/websockets";
import { Server, Socket } from "socket.io";

/**
 * Live tracking over WebSocket.  connect:  io(URL + '/tracking', { auth: { token: <accessToken> } })
 *   partner  -> emit 'location' { lat, lng, heading? }      (every 3-5s while on a delivery)
 *   customer / store -> emit 'subscribe' { orderId }         then listen to 'order:location'
 * Scale-out: add @socket.io/redis-adapter so rooms span instances.
 */
@WebSocketGateway({ namespace: "/tracking", cors: { origin: true } })
export class TrackingGateway implements OnGatewayConnection {
    private readonly log = new Logger("Tracking");
    @WebSocketServer() server: Server;
    constructor(
        private readonly tokens: TokenService,
        private readonly delivery: DeliveryService,
        private readonly prisma: PrismaService,
        private readonly redis: RedisService,
    ) {}

    async handleConnection(client: Socket) {
        try {
            const token =
                (client.handshake.auth?.token as string) ||
                (client.handshake.headers.authorization as string)?.replace(
                    "Bearer ",
                    "",
                );
            client.data.user = await this.tokens.verifyAccess(token);
        } catch {
            client.emit("error", { message: "unauthorized" });
            client.disconnect(true);
        }
    }

    @SubscribeMessage("location")
    async onLocation(
        @ConnectedSocket() client: Socket,
        @MessageBody() body: { lat: number; lng: number; heading?: number },
    ) {
        const user: AuthUser = client.data.user;
        if (user?.role !== "DELIVERY_PARTNER") return { ok: false };
        // Reject malformed coordinates before they reach the service / Redis.
        if (!Number.isFinite(+body?.lat) || !Number.isFinite(+body?.lng)) {
            return { ok: false };
        }

        const { orderIds } = await this.delivery.updateLocation(
            user,
            +body.lat,
            +body.lng,
            body.heading,
        );
        const payload = {
            lat: +body.lat,
            lng: +body.lng,
            heading: body.heading,
            at: Date.now(),
        };
        for (const id of orderIds)
            this.server
                .to(`order:${id}`)
                .emit("order:location", { orderId: id, ...payload });

        const storeRoom = user.storeId ? `delivery:live:${user.storeId}` : null;
        if (storeRoom)
            this.server.to(storeRoom).emit("delivery:location", {
                partnerId: user.id.toString(),
                storeId: user.storeId.toString(),
                ...payload,
            });
        this.server.to("delivery:live:all").emit("delivery:location", {
            partnerId: user.id.toString(),
            storeId: user.storeId?.toString() ?? null,
            ...payload,
        });
        return { ok: true };
    }

    @SubscribeMessage("subscribe-live")
    async subscribeLive(@ConnectedSocket() client: Socket) {
        const user: AuthUser = client.data.user;
        if (!user) return { ok: false };
        if (
            !["ADMIN", "SUPER_ADMIN", "STORE_MANAGER", "STORE_STAFF"].includes(
                user.role,
            )
        ) {
            return { ok: false };
        }
        if (user.role === "ADMIN" || user.role === "SUPER_ADMIN") {
            await client.join("delivery:live:all");
        } else if (user.storeId) {
            await client.join(`delivery:live:${user.storeId}`);
        }
        return { ok: true };
    }

    @SubscribeMessage("subscribe")
    async onSubscribe(
        @ConnectedSocket() client: Socket,
        @MessageBody() body: { orderId: string },
    ) {
        const user: AuthUser = client.data.user;
        if (!user || !/^\d+$/.test(String(body?.orderId))) return { ok: false };
        const id = BigInt(body.orderId);
        const where =
            user.role === "CUSTOMER"
                ? { id, userId: user.id }
                : user.role === "DELIVERY_PARTNER"
                  ? { id, deliveryPartnerId: user.id }
                  : ["STORE_MANAGER", "STORE_STAFF"].includes(user.role)
                    ? { id, storeId: user.storeId! }
                    : { id };
        if (
            !(await this.prisma.order.findFirst({
                where,
                select: { id: true },
            }))
        )
            return { ok: false };
        await client.join(`order:${id}`);
        const last = await this.redis.getJson<any>(`loc:order:${id}`);
        if (last)
            client.emit("order:location", { orderId: String(id), ...last });
        return { ok: true };
    }
}
