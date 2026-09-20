import { Injectable } from "@nestjs/common";

@Injectable()
export class ConnectionService {
	private connection?: unknown;

	onModuleInit(): void {
		this.connection = open();
	}

	beforeApplicationShutdown(): void {
		this.connection = undefined;
	}
}

declare function open(): unknown;
