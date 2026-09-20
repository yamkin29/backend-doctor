import { forwardRef, Inject, Injectable } from "@nestjs/common";

@Injectable()
export class BService {
	constructor(
		@Inject(forwardRef(() => AService))
		private readonly a: AService,
	) {}
}
