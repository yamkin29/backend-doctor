import { Module } from "@nestjs/common";
import { AService } from "./a.service.js";
import { BService } from "./b.service.js";
import { CService } from "./c.service.js";

@Module({
	providers: [AService, BService, CService],
})
export class AppModule {}
