import { Inject, Injectable } from "@nestjs/common";

@Injectable()
export class UsersService {
	constructor(
		private readonly db: DbService,
		@Inject("REPO_TOKEN") private readonly repo: UsersRepository,
	) {}

	onModuleInit(): void {}

	static helper(): number {
		return 1;
	}

	private hidden(): void {}

	public findAll(): string[] {
		return [];
	}

	async findOne(id: string): Promise<string | null> {
		return null;
	}

	protected internal(): void {}
}
