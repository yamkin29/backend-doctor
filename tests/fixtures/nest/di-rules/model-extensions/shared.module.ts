import { Injectable, Module } from "@nestjs/common";

@Injectable()
export class SharedService {}

@Module({
	providers: [SharedService],
})
export class SharedModule {}
