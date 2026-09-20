import { Controller, Get } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";

@Controller("tasks")
export class TasksController {
	constructor(
		@InjectRepository(UserEntity) private readonly users: UsersRepository,
		private readonly prisma: PrismaService,
		private readonly audit: AuditRepository,
	) {}

	@Get()
	list(): string[] {
		return [];
	}
}
