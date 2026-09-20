import { Controller, Get } from "@nestjs/common";
import { LegacyService } from "./legacy.service.js";
import { OrphanService } from "./orphan.service.js";
import { ReportService } from "./report.service.js";
import { TasksService } from "./tasks.service.js";

interface AppOptions {
	retries: number;
}

@Controller("tasks")
export class TasksController {
	constructor(
		private readonly tasks: TasksService,
		private readonly orphan: OrphanService,
		private readonly legacy: LegacyService,
		private readonly report: ReportService,
		private readonly options: AppOptions,
	) {}

	@Get()
	list(): string[] {
		return this.tasks.list();
	}
}
