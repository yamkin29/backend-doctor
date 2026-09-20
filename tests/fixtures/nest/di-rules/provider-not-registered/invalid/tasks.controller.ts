import { Controller, Get } from "@nestjs/common";
import { OrphanService } from "./orphan.service.js";
import { TasksService } from "./tasks.service.js";

@Controller("tasks")
export class TasksController {
	constructor(
		private readonly tasks: TasksService,
		private readonly orphan: OrphanService,
	) {}

	@Get()
	list(): string[] {
		return this.tasks.list();
	}
}
