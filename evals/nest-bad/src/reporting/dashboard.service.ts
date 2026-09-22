import { Injectable } from "@nestjs/common";
import { InventoryService } from "../orders/inventory.service";
import { OrdersService } from "../orders/orders.service";
import { PrismaService } from "../prisma/prisma.service";
import { LegacyCryptoService } from "../security/legacy-crypto.service";
import { LegacyExporterService } from "./legacy-exporter.service";
import { MetricsService } from "./metrics.service";

@Injectable()
export class DashboardService {
	constructor(
		private readonly orders: OrdersService,
		private readonly inventory: InventoryService,
		private readonly prisma: PrismaService,
		private readonly crypto: LegacyCryptoService,
		private readonly metrics: MetricsService,
		private readonly exporter: LegacyExporterService,
	) {}

	summary(): { orders: number; label: string } {
		return { orders: this.orders.count(), label: this.exporter.label() };
	}
}
