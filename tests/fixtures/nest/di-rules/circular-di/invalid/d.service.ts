import { Injectable } from "@nestjs/common";

@Injectable()
export class DService {
	constructor(private readonly e: EService) {}
}
