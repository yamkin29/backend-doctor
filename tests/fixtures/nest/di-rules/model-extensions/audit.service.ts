import { forwardRef, Inject, Injectable } from "@nestjs/common";

@Injectable({ scope: "singleton" })
export class AuditService {
	constructor(
		@Inject(forwardRef(() => ArchiveService))
		private readonly archive: ArchiveService,
	) {}
}
