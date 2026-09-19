import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { expectSuccess, makeTmpDir, runCli } from "./helpers.js";

const FS_RULE = "backend-doctor/no-sync-fs-in-request-path";
const CRYPTO_RULE = "backend-doctor/no-sync-crypto";
const LOOP_RULE = "backend-doctor/no-cpu-bound-loop";

function writeBlockingApp(dir: string): void {
	const src = path.join(dir, "src");
	fs.mkdirSync(src, { recursive: true });
	fs.writeFileSync(
		path.join(src, "worker.ts"),
		[
			'import fs from "node:fs";',
			'import { pbkdf2Sync } from "node:crypto";',
			"",
			"export function load(path: string): string {",
			'\treturn fs.readFileSync(path, "utf8");',
			"}",
			"",
			"export function derive(password: string, salt: string): Buffer {",
			'\treturn pbkdf2Sync(password, salt, 100_000, 32, "sha256");',
			"}",
			"",
			"export function spin(): number {",
			"\tlet total = 0;",
			"\tfor (let i = 0; i < 100_000; i++) {",
			"\t\ttotal += i;",
			"\t}",
			"\treturn total;",
			"}",
		].join("\n"),
	);
}

describe("e2e: blocking rules through the bin (AC-10, AC-11)", () => {
	it("reports blocking violations at warn and exits 0", () => {
		const dir = makeTmpDir();
		writeBlockingApp(dir);

		const result = runCli(["scan", dir, "--format", "json"]);
		expectSuccess(result, 0);

		const doc = JSON.parse(result.stdout) as {
			diagnostics: Array<{ rule: string; severity: string }>;
		};
		expect(doc.diagnostics.map((d) => [d.rule, d.severity])).toEqual([
			[FS_RULE, "warn"],
			[CRYPTO_RULE, "warn"],
			[LOOP_RULE, "warn"],
		]);
	});

	it("escalating a blocking rule to error flips the exit code to 1 (AC-10)", () => {
		const dir = makeTmpDir();
		writeBlockingApp(dir);
		const configPath = path.join(dir, "backend-doctor.config.json");
		fs.writeFileSync(
			configPath,
			JSON.stringify({ rules: { [FS_RULE]: "error" } }),
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
		const byRule = Object.fromEntries(
			doc.diagnostics.map((d) => [d.rule, d.severity]),
		);
		expect(byRule).toEqual({
			[FS_RULE]: "error",
			[CRYPTO_RULE]: "warn",
			[LOOP_RULE]: "warn",
		});
	});

	it("turning the blocking rules off removes the diagnostics (AC-10 off path)", () => {
		const dir = makeTmpDir();
		writeBlockingApp(dir);
		const configPath = path.join(dir, "backend-doctor.config.json");
		fs.writeFileSync(
			configPath,
			JSON.stringify({
				rules: { [FS_RULE]: "off", [CRYPTO_RULE]: "off", [LOOP_RULE]: "off" },
			}),
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

	it("two consecutive json scans are byte-identical (AC-11)", () => {
		const dir = makeTmpDir();
		writeBlockingApp(dir);

		const first = runCli(["scan", dir, "--format", "json"]);
		const second = runCli(["scan", dir, "--format", "json"]);
		expectSuccess(first, 0);
		expectSuccess(second, 0);
		expect(second.stdout).toBe(first.stdout);
		expect(first.stdout).toContain(FS_RULE);
		expect(first.stdout).toContain(CRYPTO_RULE);
		expect(first.stdout).toContain(LOOP_RULE);
	});
});
