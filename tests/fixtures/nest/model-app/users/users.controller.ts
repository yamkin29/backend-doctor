import { Controller, Get, Post } from "@nestjs/common";
import { UsersService } from "./users.service.js";

@Controller("users")
export class UsersController {
	constructor(private readonly users: UsersService) {}

	@Get()
	list(): string[] {
		return [];
	}

	@Get(":id")
	one(): string | null {
		return null;
	}

	@Post()
	create(): string | null {
		return null;
	}

	helper(): number {
		return this.users.count();
	}
}
