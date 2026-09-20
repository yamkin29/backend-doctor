import { Injectable } from "@nestjs/common";

@Injectable()
export class LoopService {
	constructor(private readonly loop: LoopService) {}
}
