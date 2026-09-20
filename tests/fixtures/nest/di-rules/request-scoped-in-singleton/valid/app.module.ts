import { Module } from "@nestjs/common";
import { HelperService } from "./helper.service.js";
import { PlainService } from "./plain.service.js";
import { RequestContext } from "./request-context.service.js";
import { SessionService } from "./session.service.js";
import { TransientCache } from "./transient-cache.service.js";

@Module({
	providers: [
		RequestContext,
		SessionService,
		TransientCache,
		HelperService,
		PlainService,
	],
})
export class AppModule {}
