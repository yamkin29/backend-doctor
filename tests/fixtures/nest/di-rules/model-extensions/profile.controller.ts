import { Controller, Get, Optional } from "@nestjs/common";

@Controller("profile")
export class ProfileController {
	constructor(@Optional() private readonly reporter?: ErrorReporter) {}

	@Get()
	me(): string {
		return "me";
	}
}
