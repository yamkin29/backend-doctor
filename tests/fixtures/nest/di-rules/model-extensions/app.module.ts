import { Global, Module } from "@nestjs/common";
import { CurrentUserService } from "./current-user.service.js";
import { LegacyModule } from "./legacy.module.js";
import { ProfileController } from "./profile.controller.js";
import { SharedModule } from "./shared.module.js";

const USER_TOKEN = "USER";

function makeUser(): null {
	return null;
}

@Global()
@Module({
	imports: [LegacyModule, { module: SharedModule }],
	providers: [CurrentUserService, { provide: USER_TOKEN, useFactory: makeUser }],
	controllers: [ProfileController],
})
export class AppModule {}
