import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";

@Injectable()
export class TasksService {
	constructor(
		@InjectRepository(TaskEntity) private readonly tasks: TasksRepository,
		private readonly prisma: PrismaService,
	) {}
}
