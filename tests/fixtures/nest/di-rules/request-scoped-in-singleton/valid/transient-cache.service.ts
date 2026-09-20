import { Injectable, Scope } from "@nestjs/common";
import { RequestContext } from "./request-context.service.js";

@Injectable({ scope: Scope.TRANSIENT })
export class TransientCache {
	constructor(private readonly ctx: RequestContext) {}
}
