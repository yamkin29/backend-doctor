import { Injectable } from "@nestjs/common";
import { RequestContext } from "./request-context.service.js";

@Injectable()
export class OrdersService {
	constructor(private readonly ctx: RequestContext) {}
}
