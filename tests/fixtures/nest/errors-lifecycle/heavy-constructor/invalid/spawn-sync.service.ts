import { execSync } from "node:child_process";
import { Injectable } from "@nestjs/common";

@Injectable()
export class SpawnSyncService {
	constructor() {
		execSync("git rev-parse HEAD");
	}
}
