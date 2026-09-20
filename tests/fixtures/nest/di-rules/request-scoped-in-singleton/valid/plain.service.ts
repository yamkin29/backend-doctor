import { Injectable } from "@nestjs/common";
import { HelperService } from "./helper.service.js";

@Injectable()
export class PlainService {
	constructor(private readonly helper: HelperService) {}
}
