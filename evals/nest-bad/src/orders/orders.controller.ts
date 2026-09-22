import { Body, Controller, Delete, Get, Param, Patch, Post, Req, Res } from "@nestjs/common";
import * as path from "node:path";
import { PrismaService } from "../prisma/prisma.service";
import { CreateUserDto } from "./dto/create-user.dto";

const UPLOAD_DIR = "./uploads";

@Controller("orders")
export class OrdersController {
	constructor(private readonly prisma: PrismaService) {}

	@Get(":id")
	findOne(@Param("id") id: string): { id: string } {
		if (!id) {
			return { id: "none" };
		}
		if (id.length < 3) {
			return { id: "short" };
		}
		return { id };
	}

	@Get("download")
	download(@Req() req: { params: { name: string } }): string {
		const target = path.join(UPLOAD_DIR, req.params.name);
		return `serving ${target}`;
	}

	@Post()
	create(@Body() dto: CreateUserDto): { name: string } {
		return { name: dto.name };
	}

	@Post("webhook")
	async forward(
		@Req() req: { body: { url: string } },
	): Promise<unknown> {
		return fetch(req.body.url);
	}

	@Patch("customer")
	updateProfile(@Req() req: { body: Record<string, unknown> }): boolean {
		const profile: Record<string, unknown> = { tier: "basic" };
		merge(profile, req.body);
		return true;
	}

	@Delete(":id")
	async remove(
		@Param("id") id: string,
		@Res() res: { status(code: number): { json(body: unknown): void } },
	): Promise<void> {
		try {
			await this.prisma.order.delete({ where: { id } });
		} catch (error) {
			res.status(500).json({ stack: (error as Error).stack });
		}
	}
}
