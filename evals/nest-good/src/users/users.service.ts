import { Injectable } from "@nestjs/common";
import { ConfigService } from "../config/config.service";
import { PrismaService } from "../prisma/prisma.service";
import { CreateUserDto } from "./dto/create-user.dto";
import { ListUsersDto } from "./dto/list-users.dto";

@Injectable()
export class UsersService {
	constructor(
		private readonly prisma: PrismaService,
		private readonly config: ConfigService,
	) {}

	list(params: ListUsersDto) {
		return this.prisma.user.findMany({
			take: params.take ?? 20,
			skip: params.skip ?? 0,
			orderBy: { createdAt: "desc" },
		});
	}

	create(dto: CreateUserDto) {
		return this.prisma.user.create({ data: dto });
	}

	region(): string {
		return this.config.region;
	}
}
