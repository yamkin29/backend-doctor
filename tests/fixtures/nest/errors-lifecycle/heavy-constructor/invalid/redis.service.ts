import { Injectable } from "@nestjs/common";

@Injectable()
export class RedisService {
	private readonly client = {
		$connect(): Promise<void> {
			return Promise.resolve();
		},
	};

	constructor() {
		void this.client.$connect();
	}
}
