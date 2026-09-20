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
		path.join(app, "src", "main.ts"),
		[
			'import { NestFactory } from "@nestjs/core";',
			'import { AppModule } from "./app.module.js";',
			"",
			"async function bootstrap(): Promise<void> {",
			"\tconst app = await NestFactory.create(AppModule);",
			"\tawait app.listen(3000);",
			"}",
			"",
			"void bootstrap();",
		].join("\n"),
	);
	fs.writeFileSync(
		path.join(app, "src", "app.module.ts"),
		[
			'import { Module } from "@nestjs/common";',
			'import { DashboardService } from "./dashboard.service.js";',
			'import { ReportsController } from "./reports.controller.js";',
			"",
			"@Module({",
			"\tcontrollers: [ReportsController],",
			"\tproviders: [DashboardService],",
			"})",
			"export class AppModule {}",
		].join("\n"),
	);
	fs.writeFileSync(
		path.join(app, "src", "dashboard.service.ts"),
		[
			'import { Injectable } from "@nestjs/common";',
			"",
			"@Injectable()",
			"export class DashboardService {",
			"\tconstructor(",
			"\t\tprivate readonly a: AService,",
			"\t\tprivate readonly b: BService,",
			"\t\tprivate readonly c: CService,",
			"\t\tprivate readonly d: DService,",
			"\t\tprivate readonly e: EService,",
			"\t\tprivate readonly f: FService,",
			"\t) {}",
			"}",
		].join("\n"),
	);
	fs.writeFileSync(
		path.join(app, "src", "reports.controller.ts"),
		[
			'import { Controller, Get } from "@nestjs/common";',
			"",
			'@Controller("reports")',
			"export class ReportsController {",
			"\tconstructor(",
			"\t\tprivate readonly reports: ReportsService,",
			"\t\tprivate readonly rows: ReportRowsRepository,",
			"\t) {}",
			"",
			"\t@Get()",
			"\tlist(): string[] {",
			"\t\tconst rows: string[] = [];",
			"\t\tfor (const row of rows) {",
			"\t\t\tif (row) {",
			"\t\t\t\trows.push(row);",
			"\t\t\t}",
			"\t\t}",
			"\t\treturn rows;",
			"\t}",
			"}",
		].join("\n"),
	);
	fs.writeFileSync(
		path.join(app, "src", "create-report.dto.ts"),
		[
			"export class CreateReportDto {",
			"\ttitle: string;",
			"",
			"\tmetadata: any;",
			"}",
		].join("\n"),
	);
});

afterEach(() => {
	fs.rmSync(app, { recursive: true, force: true });
});

describe("e2e: layers & DTO rules through the bin (spec 010)", () => {
	it("reports the pack violations at warn and exits 0 (AC-11)", () => {
		const result = runCli(["scan", app, "--format", "json"]);
		expectSuccess(result, 0);

		const doc = JSON.parse(result.stdout) as {
			diagnostics: Array<{
				rule: string;
				severity: string;
				filePath: string;
				line: number;
				column: number;
			}>;
		};
		expect(
			doc.diagnostics.map((d) => [
				path.relative(app, d.filePath),
				d.line,
				d.column,
				d.rule,
				d.severity,
			]),
		).toEqual([
			[
				path.join("src", "create-report.dto.ts"),
				2,
				2,
				"backend-doctor/dto-field-without-validator",
				"warn",
			],
			[
				path.join("src", "create-report.dto.ts"),
				4,
				2,
				"backend-doctor/dto-field-without-validator",
				"warn",
			],
			[
				path.join("src", "create-report.dto.ts"),
				4,
				2,
				"backend-doctor/no-any-in-dto",
				"warn",
			],
			[
				path.join("src", "dashboard.service.ts"),
				3,
				1,
				"backend-doctor/no-god-service",
				"warn",
			],
			[
				path.join("src", "main.ts"),
				5,
				20,
				"backend-doctor/missing-global-validation-pipe",
				"warn",
			],
			[
				path.join("src", "reports.controller.ts"),
				7,
				3,
				"backend-doctor/no-repository-in-controller",
				"warn",
			],
			[
				path.join("src", "reports.controller.ts"),
				10,
				2,
				"backend-doctor/no-business-logic-in-controller",
				"warn",
			],
		]);
	});

	it("two consecutive scans are byte-identical (AC-12)", () => {
		const first = runCli(["scan", app, "--format", "json"]);
		const second = runCli(["scan", app, "--format", "json"]);
		expectSuccess(first, 0);
		expect(second.stdout).toBe(first.stdout);
	});

	it("escalating no-god-service to error flips exit code to 1 (AC-13)", () => {
		const configPath = path.join(app, "backend-doctor.config.json");
		fs.writeFileSync(
			configPath,
			JSON.stringify({
				rules: { "backend-doctor/no-god-service": "error" },
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
			diagnostics: Array<{ rule: string; severity: string }>;
		};
		const god = escalatedDoc.diagnostics.find(
			(d) => d.rule === "backend-doctor/no-god-service",
		);
		expect(god?.severity).toBe("error");
	});

	it("turning the whole pack off empties the report (AC-13)", () => {
		const configPath = path.join(app, "backend-doctor.config.json");
		fs.writeFileSync(
			configPath,
			JSON.stringify({
				rules: {
					"backend-doctor/no-business-logic-in-controller": "off",
					"backend-doctor/no-repository-in-controller": "off",
					"backend-doctor/no-god-service": "off",
					"backend-doctor/missing-global-validation-pipe": "off",
					"backend-doctor/dto-field-without-validator": "off",
					"backend-doctor/no-any-in-dto": "off",
				},
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
		const packRules = new Set([
			"backend-doctor/no-business-logic-in-controller",
			"backend-doctor/no-repository-in-controller",
			"backend-doctor/no-god-service",
			"backend-doctor/missing-global-validation-pipe",
			"backend-doctor/dto-field-without-validator",
			"backend-doctor/no-any-in-dto",
		]);
		for (const line of lines) {
			const parsed = JSON.parse(line) as Record<string, unknown>;
			expect(packRules.has(parsed.rule as string)).toBe(true);
		}
	});
});
