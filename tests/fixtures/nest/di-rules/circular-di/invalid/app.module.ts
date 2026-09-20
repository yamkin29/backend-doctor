import { Module } from "@nestjs/common";
import { AService } from "./a.service.js";
import { BService } from "./b.service.js";
import { CService } from "./c.service.js";
import { DService } from "./d.service.js";
import { EService } from "./e.service.js";
import { LoopService } from "./loop.service.js";
import { OtherService } from "./other.service.js";

@Module({
	providers: [
		AService,
		BService,
		CService,
		DService,
		EService,
		LoopService,
		OtherService,
	],
})
export class AppModule {}
