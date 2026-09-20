import { Global, Module } from "@nestjs/common";
import { ReportService } from "./report.service.js";

@Global()
@Module({
	providers: [ReportService],
	exports: [ReportService],
})
export class GlobalModule {}
