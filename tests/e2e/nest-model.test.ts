import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { expectSuccess, makeTmpDir, runCli } from "./helpers.js";

let app: string;

beforeEach(() => {
	app = makeTmpDir();
	fs.writeFileSync(
		path.join(app, "package.json"),
		JSON.stringify({
			name: "nest-app",
			dependencies: { "@nestjs/common": "^10.0.0" },
		}),
	);
	fs.mkdirSync(path.join(app, "src"));
	fs.writeFileSync(
		path.join(app, "src", "app.module.ts"),
		[
			'import { Module } from "@nestjs/common";',
			'import { CatsController } from "./cats.controller.js";',
			'import { CatsService } from "./cats.service.js";',
			"",
			"@Module({",
			"\tcontrollers: [CatsController],",
			"\tproviders: [CatsService],",
			"})",
			"export class AppModule {}",
		].join("\n"),
	);
	fs.writeFileSync(
		path.join(app, "src", "cats.controller.ts"),
		[
			'import { Controller, Get, Post } from "@nestjs/common";',
			'import { CatsService } from "./cats.service.js";',
			"",
			'@Controller("cats")',
			"export class CatsController {",
			"\tconstructor(private readonly cats: CatsService) {}",
			"",
			"\t@Get()",
			"\tlist(): string[] {",
			"\t\treturn [];",
			"\t}",
			"",
			"\t@Post()",
			"\tcreate(): string {",
			'\t\treturn eval("1");',
			"\t}",
			"}",
		].join("\n"),
	);
	fs.writeFileSync(
		path.join(app, "src", "cats.service.ts"),
		[
			'import { Injectable } from "@nestjs/common";',
			"",
			"@Injectable()",
			"export class CatsService {",
			"\tcreate(): string {",
			'\t\treturn "";',
			"\t}",
			"}",
		].join("\n"),
	);
	fs.writeFileSync(
		path.join(app, "src", "create-cat.dto.ts"),
		"export class CreateCatDto {}\n",
	);
});

afterEach(() => {
	fs.rmSync(app, { recursive: true, force: true });
});

interface NestModelJson {
	modules: Array<{
		className: string;
		imports: string[];
		providers: string[];
		controllers: string[];
		exports: string[];
	}>;
	controllers: Array<{
		className: string;
		route: string | null;
		handlers: Array<{
			name: string;
			verb: string;
			path: string | null;
			line: number;
			column: number;
		}>;
	}>;
	providers: Array<{ className: string }>;
	dtos: Array<{ className: string; via: string }>;
	unresolved: unknown[];
}

describe("e2e: nest app model through the bin (spec 008)", () => {
	it("json report carries projects[0].nest with the app structure (AC-7)", () => {
		const result = runCli(["scan", app, "--format", "json"]);
		expectSuccess(result, 0);

		const doc = JSON.parse(result.stdout) as {
			schemaVersion: number;
			projects: Array<{ nest?: NestModelJson; frameworks: string[] }>;
		};
		expect(doc.schemaVersion).toBe(1);
		expect(doc.projects[0]?.frameworks).toEqual(["nest"]);

		const nest = doc.projects[0]?.nest;
		expect(nest).toBeDefined();
		expect(nest?.modules).toHaveLength(1);
		expect(nest?.modules[0]?.className).toBe("AppModule");
		expect(nest?.modules[0]?.controllers).toEqual(["CatsController"]);
		expect(nest?.modules[0]?.providers).toEqual(["CatsService"]);
		expect(nest?.controllers).toHaveLength(1);
		expect(nest?.controllers[0]?.className).toBe("CatsController");
		expect(nest?.controllers[0]?.route).toBe("cats");
		expect(nest?.controllers[0]?.handlers).toEqual([
			{ name: "list", verb: "get", path: null, line: 8, column: 2 },
			{ name: "create", verb: "post", path: null, line: 13, column: 2 },
		]);
		expect(nest?.providers.map((p) => p.className)).toEqual(["CatsService"]);
		expect(nest?.dtos).toEqual([
			{
				className: "CreateCatDto",
				filePath: expect.any(String),
				line: 1,
				column: 1,
				via: "suffix",
				properties: [],
			},
		]);
		expect(nest?.unresolved).toEqual([]);
	});

	it("jsonl stays diagnostics-only (AC-7)", () => {
		const result = runCli(["scan", app, "--format", "jsonl"]);
		expectSuccess(result, 0);

		const lines = result.stdout.trimEnd().split("\n");
		expect(lines.length).toBeGreaterThanOrEqual(1);
		for (const line of lines) {
			const parsed = JSON.parse(line) as Record<string, unknown>;
			expect(typeof parsed.rule).toBe("string");
			expect(Object.keys(parsed)).not.toContain("nest");
		}
	});

	it("non-nest projects carry no nest key (AC-7)", () => {
		const plain = makeTmpDir();
		try {
			fs.writeFileSync(
				path.join(plain, "package.json"),
				JSON.stringify({ name: "plain", dependencies: { express: "^4.19.2" } }),
			);
			fs.mkdirSync(path.join(plain, "src"));
			fs.writeFileSync(
				path.join(plain, "src", "main.ts"),
				"export const x = 1;\n",
			);

			const result = runCli(["scan", plain, "--format", "json"]);
			expectSuccess(result, 0);
			const doc = JSON.parse(result.stdout) as {
				projects: Array<Record<string, unknown>>;
			};
			expect(doc.projects[0]?.nest).toBeUndefined();
			expect(Object.keys(doc.projects[0] ?? {})).not.toContain("nest");
		} finally {
			fs.rmSync(plain, { recursive: true, force: true });
		}
	});

	it("two consecutive scans are byte-identical (AC-8)", () => {
		const first = runCli(["scan", app, "--format", "json"]);
		const second = runCli(["scan", app, "--format", "json"]);
		expectSuccess(first, 0);
		expect(second.stdout).toBe(first.stdout);
	});
});
