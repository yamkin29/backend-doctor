import { Injectable } from "@nestjs/common";

declare function connect(): Promise<unknown>;

@Injectable()
export class DialInInitService implements OnModuleInit {
	onModuleInit(): void {
		void connect();
	}
}
