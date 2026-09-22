import { Injectable } from "@nestjs/common";
import * as cp from "node:child_process";
import { RequestTrackerService } from "./request-tracker.service";

@Injectable()
export class MetricsService {
	private snapshots: string[] = [];

	constructor(private readonly tracker: RequestTrackerService) {
		cp.execSync("echo metrics-warmup", { stdio: "ignore" });
		this.refresh();
	}

	snapshot(): string[] {
		return this.snapshots;
	}

	private async refresh(): Promise<void> {
		this.snapshots.push(this.tracker.tick());
	}
}
