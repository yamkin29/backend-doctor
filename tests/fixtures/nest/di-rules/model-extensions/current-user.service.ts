import { Injectable, Scope } from "@nestjs/common";
import { LegacyService } from "./legacy.service.js";

@Injectable({ scope: Scope.REQUEST })
export class CurrentUserService {
	constructor(private readonly legacy: LegacyService) {}
}
