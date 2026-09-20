import { Module } from "@nestjs/common";
import { LegacyService } from "./legacy.service.js";

const LEGACY_TOKEN = "LEGACY";

@Module({
	providers: [LegacyService, { provide: LEGACY_TOKEN, useValue: 1 }],
	exports: [LegacyService],
})
export class LegacyModule {}
