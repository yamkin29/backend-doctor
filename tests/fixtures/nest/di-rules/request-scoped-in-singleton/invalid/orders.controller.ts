import { Controller, Get } from "@nestjs/common";
import { RequestContext } from "./request-context.service.js";

@Controller("orders")
export class OrdersController {
	constructor(private readonly ctx: RequestContext) {}

	@Get()
	list(): string[] {
		return [];
	}
}
