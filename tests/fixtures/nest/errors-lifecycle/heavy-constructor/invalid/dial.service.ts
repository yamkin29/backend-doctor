import { Injectable } from "@nestjs/common";

declare function connect(): Promise<unknown>;

@Injectable()
export class DialService {
	constructor() {
		void connect();
	}
}
