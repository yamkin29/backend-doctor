import { Module } from "@nestjs/common";
import { UsersModule } from "./users/users.module.js";
import { UsersController } from "./users/users.controller.js";
import { UsersService } from "./users/users.service.js";

@Module({
	imports: [UsersModule],
	controllers: [UsersController],
	providers: [UsersService],
})
export class AppModule {}
