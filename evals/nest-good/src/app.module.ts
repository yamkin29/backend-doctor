import { Module } from "@nestjs/common";
import { ConfigModule } from "./config/config.module";
import { HealthController } from "./health/health.controller";
import { PrismaModule } from "./prisma/prisma.module";
import { UsersModule } from "./users/users.module";

@Module({
	imports: [ConfigModule, PrismaModule, UsersModule],
	controllers: [HealthController],
})
export class AppModule {}
