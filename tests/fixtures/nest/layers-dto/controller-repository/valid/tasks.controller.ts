import { Controller, Get } from "@nestjs/common";

@Controller("tasks")
export class TasksController {
	constructor(
		private readonly users: UsersService,
		private readonly reports: RepositoryFactory,
	) {}

	@Get()
	list(): string[] {
		return [];
	}
}
