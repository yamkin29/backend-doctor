import { forwardRef, Inject, Injectable } from "@nestjs/common";

@Injectable()
export class AService {
	constructor(
		@Inject(forwardRef(() => BService))
		private readonly b: BService,
	) {}
}
