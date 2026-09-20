import { Injectable } from "@nestjs/common";

@Injectable()
export class DashboardService {
	constructor(
		private readonly a: AService,
		private readonly b: BService,
		private readonly c: CService,
		private readonly d: DService,
		private readonly e: EService,
	) {}
}
