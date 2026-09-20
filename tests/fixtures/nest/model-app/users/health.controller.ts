import { All, Controller } from "@nestjs/common";

@Controller()
export class HealthController {
	@All()
	ping(): string {
		return "ok";
	}
}
