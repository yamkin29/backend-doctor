import { Module } from "@nestjs/common";
import { OrdersModule } from "./orders/orders.module";
import { PrismaModule } from "./prisma/prisma.module";
import { ReportingModule } from "./reporting/reporting.module";

@Module({
	imports: [PrismaModule, OrdersModule, ReportingModule],
})
export class AppModule {}
