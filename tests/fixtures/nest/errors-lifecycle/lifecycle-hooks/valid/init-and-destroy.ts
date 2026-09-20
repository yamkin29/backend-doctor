import { Injectable } from "@nestjs/common";

@Injectable()
export class CacheService implements OnModuleInit, OnModuleDestroy {
	private cache = new Map<string, string>();

	onModuleInit(): void {
		this.cache.set("warm", "1");
	}

	onModuleDestroy(): void {
		this.cache.clear();
	}
}
