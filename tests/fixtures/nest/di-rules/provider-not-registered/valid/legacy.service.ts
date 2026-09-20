import { Injectable } from "@nestjs/common";

@Injectable()
export class LegacyService {
	find(): string {
		return "legacy";
	}
}
