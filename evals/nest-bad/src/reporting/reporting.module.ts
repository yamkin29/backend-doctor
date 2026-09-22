import { Module } from "@nestjs/common";
import { OrdersModule } from "../orders/orders.module";
import { PrismaModule } from "../prisma/prisma.module";
import { DashboardService } from "./dashboard.service";
import { MetricsService } from "./metrics.service";
import { RequestTrackerService } from "./request-tracker.service";

@Module({
	imports: [OrdersModule, PrismaModule],
	providers: [DashboardService, MetricsService, RequestTrackerService],
})
export class ReportingModule {}
