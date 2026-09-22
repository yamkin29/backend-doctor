import { Module } from "@nestjs/common";
import { ConfigModule } from "../config/config.module";
import { PrismaModule } from "../prisma/prisma.module";
import { UsersController } from "./users.controller";
import { UsersService } from "./users.service";

@Module({
	imports: [ConfigModule, PrismaModule],
	controllers: [UsersController],
	providers: [UsersService],
	exports: [UsersService],
})
export class UsersModule {}
