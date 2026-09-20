import { Injectable } from "@nestjs/common";

@Injectable()
export class OwnConnectService {
	constructor() {
		void this.connect();
	}

	connect(): Promise<void> {
		return Promise.resolve();
	}
}
