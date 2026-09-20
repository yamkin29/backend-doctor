import { Injectable } from "@nestjs/common";

@Injectable()
export class XService {
	constructor(private readonly y: YService) {}
}
