import { Injectable } from "@nestjs/common";

@Injectable()
export class YService {
	constructor(private readonly x: XService) {}
}
