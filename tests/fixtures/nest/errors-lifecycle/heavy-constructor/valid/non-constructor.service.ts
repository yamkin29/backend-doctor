import { execSync } from "node:child_process";
import { Injectable } from "@nestjs/common";

@Injectable()
export class InspectService {
	revision(): string {
		return execSync("git rev-parse HEAD").toString().trim();
	}
}
