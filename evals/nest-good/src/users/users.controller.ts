import { Body, Controller, Get, Post, Query } from "@nestjs/common";
import { CreateUserDto } from "./dto/create-user.dto";
import { ListUsersDto } from "./dto/list-users.dto";
import { UsersService } from "./users.service";

@Controller("users")
export class UsersController {
	constructor(private readonly users: UsersService) {}

	@Get()
	list(@Query() params: ListUsersDto) {
		return this.users.list(params);
	}

	@Post()
	create(@Body() dto: CreateUserDto) {
		return this.users.create(dto);
	}
}
