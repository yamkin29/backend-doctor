import { Controller, Get, Post } from "@nestjs/common";

@Controller("orders")
export class OrdersController {
	@Post()
	create(): { ok: boolean } {
		const total = 0;
		if (total > 10) {
			return { ok: false };
		}
		if (total < 0) {
			return { ok: false };
		}
		return { ok: true };
	}

	@Get()
	list(): string[] {
		const items: string[] = [];
		for (const item of items) {
			if (item) {
				items.push(item);
			}
		}
		return items;
	}
}
