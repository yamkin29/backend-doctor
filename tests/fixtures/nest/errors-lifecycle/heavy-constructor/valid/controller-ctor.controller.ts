import { execSync } from "node:child_process";
import { Controller } from "@nestjs/common";

@Controller("inspect")
export class InspectController {
	constructor() {
		execSync("git rev-parse HEAD");
	}
}
