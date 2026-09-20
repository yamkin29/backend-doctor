import { Module } from "@nestjs/common";
import { UsersService } from "../users/users.service.js";

const extra = [UsersService];
const token = "TOKEN";

function buildMetadata(): Record<string, unknown> {
	return {};
}

@Module({
	imports: [UsersService],
	providers: [...extra, { provide: token, useValue: null }],
	exports: UsersService,
})
export class DynamicModule {}

@Module(buildMetadata())
export class LooseModule {}
