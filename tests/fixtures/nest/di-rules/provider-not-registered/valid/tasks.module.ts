import { Module } from "@nestjs/common";
import { LegacyModule } from "./legacy.module.js";
import { OrphanService } from "./orphan.service.js";
import { TasksController } from "./tasks.controller.js";
import { TasksService } from "./tasks.service.js";

@Module({
	imports: [LegacyModule],
	controllers: [TasksController],
	providers: [TasksService, OrphanService],
})
export class TasksModule {}
