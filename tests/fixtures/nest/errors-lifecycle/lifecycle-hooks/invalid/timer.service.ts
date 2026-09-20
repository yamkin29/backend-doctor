import { Injectable } from "@nestjs/common";

@Injectable()
export class TimerService {
	private timer?: ReturnType<typeof setInterval>;

	onModuleInit(): void {
		this.timer = setInterval(() => {}, 1000);
	}
}
