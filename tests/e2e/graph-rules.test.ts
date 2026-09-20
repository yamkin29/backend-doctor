import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { expectSuccess, makeTmpDir, runCli } from "./helpers.js";

const PACK_RULES = [
	"backend-doctor/circular-dependency",
	"backend-doctor/unused-dependency",
	"backend-doctor/unused-export",
	"backend-doctor/unused-file",
];

let app: string;

beforeEach(() => {
	app = makeTmpDir();
	fs.writeFileSync(
		path.join(app, "package.json"),
		JSON.stringify({
			name: "app",
			scripts: { start: "node dist/main.js" },
			dependencies: { express: "^4.0.0", "left-pad": "^1.0.0" },
		}),
	);
	fs.mkdirSync(path.join(app, "src"));
	fs.writeFileSync(
		path.join(app, "src", "main.ts"),
		'import { start } from "./app";\n\nvoid start();\n',
	);
	fs.writeFileSync(
		path.join(app, "src", "app.ts"),
		[
			'import express from "express";',
			'import { helper } from "./helper";',
			"",
			"export function start(): string {",
			"\treturn helper() + express;",
			"}",
		].join("\n"),
	);
	fs.writeFileSync(
		path.join(app, "src", "helper.ts"),
		[
			'import { start } from "./app";',
			"",
			"export function helper(): string {",
			"\treturn start();",
			"}",
		].join("\n"),
	);
	fs.writeFileSync(
		path.join(app, "src", "orphan.ts"),
		["export function orphan(): number {", "\treturn 1;", "}"].join("\n"),
	);
});

afterEach(() => {
	fs.rmSync(app, { recursive: true, force: true });
});

describe("e2e: graph rules through the bin (spec 013)", () => {
	it("reports cycles, orphans, unused exports and dependencies at warn (AC-6)", () => {
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
			["package.json", 1, 1, "backend-doctor/unused-dependency", "warn"],
			[
				path.join("src", "app.ts"),
				2,
				1,
				"backend-doctor/circular-dependency",
				"warn",
			],
			[
				path.join("src", "helper.ts"),
				1,
				1,
				"backend-doctor/circular-dependency",
				"warn",
			],
			[
				path.join("src", "orphan.ts"),
				1,
				1,
				"backend-doctor/unused-export",
				"warn",
			],
			[
				path.join("src", "orphan.ts"),
				1,
				1,
				"backend-doctor/unused-file",
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

	it("escalating unused-export to error flips exit code to 1 (AC-6)", () => {
		const configPath = path.join(app, "backend-doctor.config.json");
		fs.writeFileSync(
			configPath,
			JSON.stringify({
				rules: { "backend-doctor/unused-export": "error" },
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
		const unused = escalatedDoc.diagnostics.find(
			(d) => d.rule === "backend-doctor/unused-export",
		);
		expect(unused?.severity).toBe("error");
	});

	it("turning the whole pack off empties the report (AC-6)", () => {
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

	it("jsonl stays diagnostics-only (AC-6)", () => {
		const result = runCli(["scan", app, "--format", "jsonl"]);
		expectSuccess(result, 0);
		const lines = result.stdout.trimEnd().split("\n");
		expect(lines).toHaveLength(5);
		const packRules = new Set(PACK_RULES);
		for (const line of lines) {
			const parsed = JSON.parse(line) as Record<string, unknown>;
			expect(packRules.has(parsed.rule as string)).toBe(true);
		}
	});

	it("a single-file scan target does not crash the graph pack (AC-8)", () => {
		const result = runCli([
			"scan",
			path.join(app, "src", "main.ts"),
			"--format",
			"json",
		]);
		expectSuccess(result, 0);
		const doc = JSON.parse(result.stdout) as {
			diagnostics: Array<Record<string, unknown>>;
		};
		expect(Array.isArray(doc.diagnostics)).toBe(true);
	});
});
