import { Injectable } from "@nestjs/common";
import { z } from "zod";

const envSchema = z.object({
	DATABASE_URL: z.string().min(1),
	REGION: z.string().default("eu-west-1"),
});

type AppEnv = z.infer<typeof envSchema>;

function parseEnv(): AppEnv {
	return envSchema.parse(process.env);
}

@Injectable()
export class ConfigService {
	readonly databaseUrl: string;
	readonly region: string;

	constructor() {
		const env = parseEnv();
		this.databaseUrl = env.DATABASE_URL;
		this.region = env.REGION;
	}
}
