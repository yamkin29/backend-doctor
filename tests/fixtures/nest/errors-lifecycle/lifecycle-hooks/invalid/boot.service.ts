import { Injectable } from "@nestjs/common";

@Injectable()
export class BootService {
	private handle?: unknown;

	onApplicationBootstrap(): void {
		this.handle = setTimeout(() => {}, 0);
	}
}
