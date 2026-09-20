import { Injectable } from "@nestjs/common";

@Injectable()
export class AService {
	constructor(private readonly b: BService) {}
}
