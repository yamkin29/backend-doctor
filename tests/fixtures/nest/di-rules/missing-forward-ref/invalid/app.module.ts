import { Module } from "@nestjs/common";
import { XService } from "./x.service.js";
import { YService } from "./y.service.js";

@Module({
	providers: [XService, YService],
})
export class AppModule {}
