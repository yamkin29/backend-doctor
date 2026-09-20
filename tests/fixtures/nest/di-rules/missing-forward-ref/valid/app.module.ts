import { Module } from "@nestjs/common";
import { AService } from "./a.service.js";
import { BService } from "./b.service.js";
import { CService } from "./c.service.js";
import { DService } from "./d.service.js";
import { OrdersService } from "./orders.service.js";
import { RequestContext } from "./request-context.service.js";

@Module({
	providers: [AService, BService, CService, DService, OrdersService, RequestContext],
})
export class AppModule {}
