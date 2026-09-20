import { Module } from "@nestjs/common";
import { UsersService } from "./users.service.js";

export const TOKEN = "TOKEN";
export const FACTORY = "FACTORY";

function makeService(): UsersService {
	return new UsersService();
}

@Module({
	providers: [
		UsersService,
		{ provide: TOKEN, useClass: UsersService },
		{ provide: FACTORY, useFactory: makeService },
	],
	exports: [UsersService],
})
export class UsersModule {}
