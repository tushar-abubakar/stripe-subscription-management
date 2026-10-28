import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PrismaClient } from "@prisma-client/client";
import { PrismaPg } from "@prisma/adapter-pg";

@Injectable()
export class PrismaService
    extends PrismaClient
    implements OnModuleInit, OnModuleDestroy
{
    constructor(configService: ConfigService) {
        const connectionString =
            configService.getOrThrow<string>("database.url");
        const adapter = new PrismaPg({ connectionString });
        super({ adapter });
    }

    async onModuleInit(): Promise<void> {
        await this.$connect();
    }

    async onModuleDestroy(): Promise<void> {
        await this.$disconnect();
    }
}
