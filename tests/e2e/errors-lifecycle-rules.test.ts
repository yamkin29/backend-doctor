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
		path.join(app, "src", "app.ts"),
		[
			"declare function save(error: Error): void;",
			"",
			"export function report(",
			"\terror: Error,",
			"\tres: { json(body: unknown): void },",
			"): void {",
			"\ttry {",
			"\t\tsave(error);",
			"\t} catch {}",
			'\tres.json({ message: "failed", stack: error.stack });',
			"}",
		].join("\n"),
	);
	fs.writeFileSync(
		path.join(app, "src", "timer.service.ts"),
		[
			'import { Injectable } from "@nestjs/common";',
			"",
			"declare function connect(): Promise<unknown>;",
			"",
			"@Injectable()",
			"export class TimerService {",
			"\tconstructor() {",
			"\t\tvoid connect();",
			"\t}",
			"",
			"\tonModuleInit(): void {}",
			"}",
		].join("\n"),
	);
});

afterEach(() => {
	fs.rmSync(app, { recursive: true, force: true });
});

const PACK_RULES = [
	"backend-doctor/no-empty-catch",
	"backend-doctor/no-error-details-leak",
	"backend-doctor/missing-on-module-destroy",
	"backend-doctor/no-heavy-constructor-work",
];

describe("e2e: errors & lifecycle rules through the bin (spec 011)", () => {
	it("reports the pack violations at warn and exits 0 (AC-6)", () => {
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
				path.join("src", "app.ts"),
				9,
				4,
				"backend-doctor/no-empty-catch",
				"warn",
			],
			[
				path.join("src", "app.ts"),
				10,
				2,
				"backend-doctor/no-error-details-leak",
				"warn",
			],
			[
				path.join("src", "timer.service.ts"),
				5,
				1,
				"backend-doctor/missing-on-module-destroy",
				"warn",
			],
			[
				path.join("src", "timer.service.ts"),
				8,
				8,
				"backend-doctor/no-heavy-constructor-work",
				"warn",
			],
		]);
	});

	it("two consecutive scans are byte-identical (AC-7)", () => {
		const first = runCli(["scan", app, "--format", "json"]);
		const second = runCli(["scan", app, "--format", "json"]);
		expectSuccess(first, 0);
		expect(second.stdout).toBe(first.stdout);
	});

	it("escalating no-empty-catch to error flips exit code to 1 (AC-8)", () => {
		const configPath = path.join(app, "backend-doctor.config.json");
		fs.writeFileSync(
			configPath,
			JSON.stringify({
				rules: { "backend-doctor/no-empty-catch": "error" },
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
		const empty = escalatedDoc.diagnostics.find(
			(d) => d.rule === "backend-doctor/no-empty-catch",
		);
		expect(empty?.severity).toBe("error");
	});

	it("turning the whole pack off empties the report (AC-8)", () => {
		const configPath = path.join(app, "backend-doctor.config.json");
		fs.writeFileSync(
			configPath,
			JSON.stringify({
				rules: Object.fromEntries(PACK_RULES.map((rule) => [rule, "off"])),
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

	it("jsonl stays diagnostics-only (AC-8)", () => {
		const result = runCli(["scan", app, "--format", "jsonl"]);
		expectSuccess(result, 0);
		const lines = result.stdout.trimEnd().split("\n");
		expect(lines).toHaveLength(4);
		const packRules = new Set(PACK_RULES);
		for (const line of lines) {
			const parsed = JSON.parse(line) as Record<string, unknown>;
			expect(packRules.has(parsed.rule as string)).toBe(true);
		}
	});
});
