import { Injectable } from "@nestjs/common";

@Injectable()
export class EService {
	constructor(private readonly c: CService) {}
}
