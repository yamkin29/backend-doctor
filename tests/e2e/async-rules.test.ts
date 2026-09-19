import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { expectSuccess, makeTmpDir, runCli } from "./helpers.js";

const FLOATING_RULE = "backend-doctor/no-floating-promises";

function writeAsyncApp(dir: string): void {
	const src = path.join(dir, "src");
	fs.mkdirSync(src, { recursive: true });
	fs.writeFileSync(
		path.join(src, "jobs.ts"),
		["async function job(): Promise<void> {}", "job();"].join("\n"),
	);
}

describe("e2e: async rules through the bin (AC-17, AC-18)", () => {
	it("reports floating promises at warn and exits 0", () => {
		const dir = makeTmpDir();
		writeAsyncApp(dir);

		const result = runCli(["scan", dir, "--format", "json"]);
		expectSuccess(result, 0);

		const doc = JSON.parse(result.stdout) as {
			diagnostics: Array<{ rule: string; severity: string }>;
		};
		expect(doc.diagnostics.map((d) => [d.rule, d.severity])).toEqual([
			[FLOATING_RULE, "warn"],
		]);
	});

	it("escalating the rule to error flips the exit code to 1 (AC-17)", () => {
		const dir = makeTmpDir();
		writeAsyncApp(dir);
		const configPath = path.join(dir, "backend-doctor.config.json");
		fs.writeFileSync(
			configPath,
			JSON.stringify({ rules: { [FLOATING_RULE]: "error" } }),
		);

		const result = runCli([
			"scan",
			dir,
			"--format",
			"json",
			"--config",
			configPath,
		]);
		expectSuccess(result, 1);

		const doc = JSON.parse(result.stdout) as {
			diagnostics: Array<{ rule: string; severity: string }>;
		};
		expect(doc.diagnostics[0]?.severity).toBe("error");
	});

	it("turning the rule off removes the diagnostic (AC-17 off path)", () => {
		const dir = makeTmpDir();
		writeAsyncApp(dir);
		const configPath = path.join(dir, "backend-doctor.config.json");
		fs.writeFileSync(
			configPath,
			JSON.stringify({ rules: { [FLOATING_RULE]: "off" } }),
		);

		const result = runCli([
			"scan",
			dir,
			"--format",
			"json",
			"--config",
			configPath,
		]);
		expectSuccess(result, 0);

		const doc = JSON.parse(result.stdout) as {
			diagnostics: Array<{ rule: string }>;
		};
		expect(doc.diagnostics).toEqual([]);
	});

	it("two consecutive json scans are byte-identical (AC-18)", () => {
		const dir = makeTmpDir();
		writeAsyncApp(dir);

		const first = runCli(["scan", dir, "--format", "json"]);
		const second = runCli(["scan", dir, "--format", "json"]);
		expectSuccess(first, 0);
		expectSuccess(second, 0);
		expect(second.stdout).toBe(first.stdout);
		expect(first.stdout).toContain(FLOATING_RULE);
	});
});
