import { Module } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module";
import { LegacyCryptoService } from "../security/legacy-crypto.service";
import { InventoryService } from "./inventory.service";
import { OrdersController } from "./orders.controller";
import { OrdersService } from "./orders.service";

@Module({
	imports: [PrismaModule],
	controllers: [OrdersController],
	providers: [OrdersService, InventoryService, LegacyCryptoService],
	exports: [OrdersService, InventoryService, LegacyCryptoService],
})
export class OrdersModule {}
