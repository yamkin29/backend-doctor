import { Injectable, Scope } from "@nestjs/common";
import { RequestContext } from "./request-context.service.js";

@Injectable({ scope: Scope.REQUEST })
export class AuditTrail {
	constructor(private readonly ctx: RequestContext) {}
}
