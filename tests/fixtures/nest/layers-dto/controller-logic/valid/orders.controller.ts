import { Controller, Get, NotFoundException, Param } from "@nestjs/common";

@Controller("orders")
export class OrdersController {
	@Get(":id")
	one(@Param("id") id: string): string {
		if (!id) {
			throw new NotFoundException();
		}
		return id;
	}

	@Get()
	list(): string[] {
		return this.all();
	}

	all(): string[] {
		return [];
	}
}
