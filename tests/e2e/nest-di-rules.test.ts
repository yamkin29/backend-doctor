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
			'import { TasksController } from "./tasks.controller.js";',
			'import { TasksService } from "./tasks.service.js";',
			"",
			"@Module({",
			"\tcontrollers: [TasksController],",
			"\tproviders: [TasksService],",
			"})",
			"export class AppModule {}",
		].join("\n"),
	);
	fs.writeFileSync(
		path.join(app, "src", "tasks.service.ts"),
		[
			'import { Injectable } from "@nestjs/common";',
			"",
			"@Injectable()",
			"export class TasksService {}",
		].join("\n"),
	);
	fs.writeFileSync(
		path.join(app, "src", "orphan.service.ts"),
		[
			'import { Injectable } from "@nestjs/common";',
			"",
			"@Injectable()",
			"export class OrphanService {}",
		].join("\n"),
	);
	fs.writeFileSync(
		path.join(app, "src", "tasks.controller.ts"),
		[
			'import { Controller, Get } from "@nestjs/common";',
			'import { OrphanService } from "./orphan.service.js";',
			'import { TasksService } from "./tasks.service.js";',
			"",
			'@Controller("tasks")',
			"export class TasksController {",
			"\tconstructor(",
			"\t\tprivate readonly tasks: TasksService,",
			"\t\tprivate readonly orphan: OrphanService,",
			"\t) {}",
			"",
			"\t@Get()",
			"\tlist(): string[] {",
			"\t\treturn [];",
			"\t}",
			"}",
		].join("\n"),
	);
});

afterEach(() => {
	fs.rmSync(app, { recursive: true, force: true });
});

describe("e2e: nest DI rules through the bin (spec 009)", () => {
	it("reports the unregistered provider and carries the wiring in projects[0].nest (AC-6)", () => {
		const result = runCli(["scan", app, "--format", "json"]);
		expectSuccess(result, 0);

		const doc = JSON.parse(result.stdout) as {
			diagnostics: Array<{
				rule: string;
				severity: string;
				category: string;
				line: number;
				column: number;
				filePath: string;
			}>;
			projects: Array<{
				nest?: {
					controllers: Array<{ className: string; injections: unknown[] }>;
					providers: Array<{ className: string; scope: string | null }>;
				};
			}>;
		};
		expect(doc.diagnostics).toHaveLength(1);
		const finding = doc.diagnostics[0];
		expect(finding?.rule).toBe("backend-doctor/provider-not-registered");
		expect(finding?.severity).toBe("warn");
		expect(finding?.category).toBe("Correctness");
		expect(finding?.filePath).toBe(
			path.join(app, "src", "tasks.controller.ts"),
		);
		expect(finding?.line).toBe(9);

		const nest = doc.projects[0]?.nest;
		expect(nest?.controllers[0]?.className).toBe("TasksController");
		expect(nest?.controllers[0]?.injections).toHaveLength(2);
		expect(nest?.providers.map((p) => [p.className, p.scope])).toEqual([
			["OrphanService", null],
			["TasksService", null],
		]);
	});

	it("two consecutive scans are byte-identical (AC-12)", () => {
		const first = runCli(["scan", app, "--format", "json"]);
		const second = runCli(["scan", app, "--format", "json"]);
		expectSuccess(first, 0);
		expect(second.stdout).toBe(first.stdout);
	});

	it("escalating to error flips exit code to 1; off silences the rule (AC-13)", () => {
		const configPath = path.join(app, "backend-doctor.config.json");
		fs.writeFileSync(
			configPath,
			JSON.stringify({
				rules: { "backend-doctor/provider-not-registered": "error" },
			}),
		);
		const escalated = runCli([
			"scan",
			app,
			"--format",
			"json",
			"--config",
			configPath,
		]);
		expectSuccess(escalated, 1);
		const escalatedDoc = JSON.parse(escalated.stdout) as {
			diagnostics: Array<{ severity: string }>;
		};
		expect(escalatedDoc.diagnostics[0]?.severity).toBe("error");

		fs.writeFileSync(
			configPath,
			JSON.stringify({
				rules: { "backend-doctor/provider-not-registered": "off" },
			}),
		);
		const silenced = runCli([
			"scan",
			app,
			"--format",
			"json",
			"--config",
			configPath,
		]);
		expectSuccess(silenced, 0);
		const silencedDoc = JSON.parse(silenced.stdout) as {
			diagnostics: unknown[];
		};
		expect(silencedDoc.diagnostics).toEqual([]);
	});

	it("jsonl stays diagnostics-only (AC-13)", () => {
		const result = runCli(["scan", app, "--format", "jsonl"]);
		expectSuccess(result, 0);
		const lines = result.stdout.trimEnd().split("\n");
		expect(lines.length).toBeGreaterThanOrEqual(1);
		for (const line of lines) {
			const parsed = JSON.parse(line) as Record<string, unknown>;
			expect(parsed.rule).toBe("backend-doctor/provider-not-registered");
		}
	});

	it("reports a forwardRef-less cycle with both cycle diagnostics (AC-8, AC-9)", () => {
		fs.writeFileSync(
			path.join(app, "src", "x.service.ts"),
			[
				'import { Injectable } from "@nestjs/common";',
				'import { YService } from "./y.service.js";',
				"",
				"@Injectable()",
				"export class XService {",
				"\tconstructor(private readonly y: YService) {}",
				"}",
			].join("\n"),
		);
		fs.writeFileSync(
			path.join(app, "src", "y.service.ts"),
			[
				'import { Injectable } from "@nestjs/common";',
				'import { XService } from "./x.service.js";',
				"",
				"@Injectable()",
				"export class YService {",
				"\tconstructor(private readonly x: XService) {}",
				"}",
			].join("\n"),
		);
		fs.writeFileSync(
			path.join(app, "src", "app.module.ts"),
			[
				'import { Module } from "@nestjs/common";',
				'import { TasksController } from "./tasks.controller.js";',
				'import { TasksService } from "./tasks.service.js";',
				'import { XService } from "./x.service.js";',
				'import { YService } from "./y.service.js";',
				"",
				"@Module({",
				"\tcontrollers: [TasksController],",
				"\tproviders: [TasksService, XService, YService],",
				"})",
				"export class AppModule {}",
			].join("\n"),
		);

		const result = runCli(["scan", app, "--format", "json"]);
		expectSuccess(result, 0);
		const doc = JSON.parse(result.stdout) as {
			diagnostics: Array<{ rule: string; filePath: string; line: number }>;
		};
		expect(
			doc.diagnostics.map((d) => [
				path.relative(app, d.filePath),
				d.line,
				d.rule,
			]),
		).toEqual([
			[
				path.join("src", "tasks.controller.ts"),
				9,
				"backend-doctor/provider-not-registered",
			],
			[
				path.join("src", "x.service.ts"),
				2,
				"backend-doctor/circular-dependency",
			],
			[path.join("src", "x.service.ts"), 4, "backend-doctor/circular-di"],
			[
				path.join("src", "y.service.ts"),
				2,
				"backend-doctor/circular-dependency",
			],
			[
				path.join("src", "y.service.ts"),
				6,
				"backend-doctor/missing-forward-ref",
			],
		]);
	});
});
