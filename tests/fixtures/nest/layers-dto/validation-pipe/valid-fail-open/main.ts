import { NestFactory } from "@nestjs/core";
import { BrokenModule } from "./broken.module.js";

async function bootstrap(): Promise<void> {
	const app = await NestFactory.create(BrokenModule);
	await app.listen(3000);
}

bootstrap();
