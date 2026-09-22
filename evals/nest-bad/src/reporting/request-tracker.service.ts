import { Injectable, Scope } from "@nestjs/common";

@Injectable({ scope: Scope.REQUEST })
export class RequestTrackerService {
	tick(): string {
		return new Date().toISOString();
	}
}
