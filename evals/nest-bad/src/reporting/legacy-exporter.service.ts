import { Injectable } from "@nestjs/common";

@Injectable()
export class LegacyExporterService {
	label(): string {
		return "legacy-exporter";
	}
}
