import { Injectable, type OnModuleInit } from "@nestjs/common";
import { OrdersService } from "./orders.service";

@Injectable()
export class InventoryService {
	private ready = false;

	constructor(private readonly orders: OrdersService) {}

	onModuleInit(): void {
		this.ready = this.orders.hasStock();
	}

	reserve(id: string): boolean {
		return this.ready && id.length > 0;
	}
}
