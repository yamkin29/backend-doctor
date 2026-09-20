import { Module } from "@nestjs/common";
import { AuditTrail } from "./audit-trail.service.js";
import { OrdersController } from "./orders.controller.js";
import { OrdersService } from "./orders.service.js";
import { RequestContext } from "./request-context.service.js";

@Module({
	controllers: [OrdersController],
	providers: [RequestContext, AuditTrail, OrdersService],
})
export class AppModule {}
