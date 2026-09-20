import { Injectable } from "@nestjs/common";

@Injectable()
export class CService {
	constructor(private readonly d: DService) {}
}
