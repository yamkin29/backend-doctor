import { Injectable } from "@nestjs/common";

@Injectable()
export class BService {
	constructor(private readonly c: CService) {}
}
