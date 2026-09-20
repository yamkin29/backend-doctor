import { APP_PIPE, Module } from "@nestjs/common";
import { ValidationPipe } from "@nestjs/common";

@Module({
	providers: [
		{
			provide: APP_PIPE,
			useClass: ValidationPipe,
		},
	],
})
export class AppModule {}
