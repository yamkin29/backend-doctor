import { Module } from "@nestjs/common";
import { LegacyService } from "./legacy.service.js";

@Module({
	providers: [LegacyService],
	exports: [LegacyService],
})
export class LegacyModule {}
