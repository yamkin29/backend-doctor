import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { expectSuccess, makeTmpDir, runCli } from "./helpers.js";

const PACK_RULES = [
	"backend-doctor/no-direct-process-env",
	"backend-doctor/env-without-validation",
	"backend-doctor/no-committed-env",
];

let app: string;

beforeEach(() => {
	app = makeTmpDir();
	fs.writeFileSync(
		path.join(app, "package.json"),
		JSON.stringify({ name: "app" }),
	);
	fs.mkdirSync(path.join(app, "src"));
	fs.writeFileSync(
		path.join(app, "src", "main.ts"),
		[
			"export function boot(): number {",
			"\treturn Number(process.env.PORT);",
			"}",
		].join("\n"),
	);
	fs.writeFileSync(path.join(app, ".env"), "PORT=3000\n");
});

afterEach(() => {
	fs.rmSync(app, { recursive: true, force: true });
});

describe("e2e: config/env rules through the bin (spec 014)", () => {
	it("reports scattered env reads, the unvalidated census and the dotenv file (AC-1..3)", () => {
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
			[".env", 1, 1, "backend-doctor/no-committed-env", "warn"],
			[
				path.join("src", "main.ts"),
				2,
				16,
				"backend-doctor/env-without-validation",
				"warn",
			],
			[
				path.join("src", "main.ts"),
				2,
				16,
				"backend-doctor/no-direct-process-env",
				"warn",
			],
		]);
	});

	it("two consecutive scans are byte-identical (AC-6)", () => {
		const first = runCli(["scan", app, "--format", "json"]);
		const second = runCli(["scan", app, "--format", "json"]);
		expectSuccess(first, 0);
		expect(second.stdout).toBe(first.stdout);
	});

	it("escalating no-direct-process-env to error flips exit code to 1 (AC-5)", () => {
		const configPath = path.join(app, "backend-doctor.config.json");
		fs.writeFileSync(
			configPath,
			JSON.stringify({
				rules: { "backend-doctor/no-direct-process-env": "error" },
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
		const direct = escalatedDoc.diagnostics.find(
			(d) => d.rule === "backend-doctor/no-direct-process-env",
		);
		expect(direct?.severity).toBe("error");
	});

	it("turning the whole pack off empties the report (AC-5)", () => {
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

	it("jsonl stays diagnostics-only (AC-5)", () => {
		const result = runCli(["scan", app, "--format", "jsonl"]);
		expectSuccess(result, 0);
		const lines = result.stdout.trimEnd().split("\n");
		expect(lines).toHaveLength(3);
		const packRules = new Set(PACK_RULES);
		for (const line of lines) {
			const parsed = JSON.parse(line) as Record<string, unknown>;
			expect(packRules.has(parsed.rule as string)).toBe(true);
		}
	});

	it("a single-file scan target does not crash the pack (AC-7)", () => {
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
