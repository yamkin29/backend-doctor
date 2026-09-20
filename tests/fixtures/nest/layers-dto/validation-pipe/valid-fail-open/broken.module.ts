import { Module } from "@nestjs/common";

@Module({
	providers: [makeProviders()],
})
export class BrokenModule {}
