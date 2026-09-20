import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { expectSuccess, makeTmpDir, runCli } from "./helpers.js";

const COMMAND_RULE = "backend-doctor/no-command-injection";
const PATH_RULE = "backend-doctor/no-path-traversal";
const SECRETS_RULE = "backend-doctor/no-hardcoded-secrets";
const CRYPTO_RULE = "backend-doctor/no-weak-crypto";
const SSRF_RULE = "backend-doctor/no-ssrf";
const MERGE_RULE = "backend-doctor/no-unsafe-merge";

// Report order: the violations sit one per line in the staged app, so the
// sorted diagnostics follow this sequence.
const SECURITY_RULES = [
	SECRETS_RULE,
	PATH_RULE,
	COMMAND_RULE,
	CRYPTO_RULE,
	MERGE_RULE,
	SSRF_RULE,
];

function writeSecurityApp(dir: string): void {
	const src = path.join(dir, "src");
	fs.mkdirSync(src, { recursive: true });
	fs.writeFileSync(
		path.join(src, "api.ts"),
		[
			'import { exec } from "node:child_process";',
			'import path from "node:path";',
			'import { createHash } from "node:crypto";',
			'import axios from "axios";',
			'import _ from "lodash";',
			"",
			'const apiKey = "sk_live_9fK3pXwR7vTqzLm5Yh8Cd1BnJ2";',
			"",
			"export async function handle(req: {",
			"\tbody: Record<string, string>;",
			"\tparams: { file: string };",
			"\tquery: { url: string };",
			"}): Promise<unknown> {",
			'\tconst file = path.join("/uploads", req.params.file);',
			"\tconst listing = exec(`ls ${file}`);",
			'\tconst digest = createHash("md5").update(listing).digest("hex");',
			"\tconst body = Object.assign({}, req.body);",
			"\tconst response = await axios.get(req.query.url);",
			"\treturn { file, listing, digest, body, response };",
			"}",
		].join("\n"),
	);
}

describe("e2e: security rules through the bin (AC-14, AC-15)", () => {
	it("reports the six security violations at warn and exits 0 (AC-14)", () => {
		const dir = makeTmpDir();
		writeSecurityApp(dir);

		const result = runCli(["scan", dir, "--format", "json"]);
		expectSuccess(result, 0);

		const doc = JSON.parse(result.stdout) as {
			diagnostics: Array<{ rule: string; severity: string }>;
		};
		expect(doc.diagnostics.map((d) => [d.rule, d.severity])).toEqual(
			SECURITY_RULES.map((rule) => [rule, "warn"]),
		);
	});

	it("escalating a security rule to error flips the exit code to 1 (AC-14)", () => {
		const dir = makeTmpDir();
		writeSecurityApp(dir);
		const configPath = path.join(dir, "backend-doctor.config.json");
		fs.writeFileSync(
			configPath,
			JSON.stringify({ rules: { [SSRF_RULE]: "error" } }),
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
		const expected = Object.fromEntries(
			SECURITY_RULES.map((rule) => [
				rule,
				rule === SSRF_RULE ? "error" : "warn",
			]),
		);
		expect(byRule).toEqual(expected);
	});

	it("turning the security rules off removes the diagnostics (AC-14 off path)", () => {
		const dir = makeTmpDir();
		writeSecurityApp(dir);
		const configPath = path.join(dir, "backend-doctor.config.json");
		fs.writeFileSync(
			configPath,
			JSON.stringify({
				rules: Object.fromEntries(SECURITY_RULES.map((rule) => [rule, "off"])),
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

	it("two consecutive json scans are byte-identical (AC-15)", () => {
		const dir = makeTmpDir();
		writeSecurityApp(dir);

		const first = runCli(["scan", dir, "--format", "json"]);
		const second = runCli(["scan", dir, "--format", "json"]);
		expectSuccess(first, 0);
		expectSuccess(second, 0);
		expect(second.stdout).toBe(first.stdout);
		for (const rule of SECURITY_RULES) {
			expect(first.stdout).toContain(rule);
		}
	});
});
