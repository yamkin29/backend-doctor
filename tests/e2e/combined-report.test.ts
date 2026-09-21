import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { expectSuccess, makeTmpDir, runCli } from "./helpers.js";

const repoRoot = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	"../..",
);
const BAD_APP = path.join(repoRoot, "tests/fixtures/engine/bad-app");

/**
 * A hand-crafted probe session directory (spec 021): one blocking call
 * recorded the way the F019 hook records it — culprit path relative to the
 * probe cwd, here the bad-app tree, colocated with the static no-eval hit
 * at src/index.ts:3:15.
 */
function seedSession(options?: { cwd?: string }): string {
	const dir = makeTmpDir();
	fs.writeFileSync(
		path.join(dir, "session.json"),
		`${JSON.stringify({
			traceSchemaVersion: 1,
			session: { cwd: options?.cwd ?? BAD_APP },
		})}\n`,
	);
	fs.writeFileSync(
		path.join(dir, "findings.json"),
		`${JSON.stringify({
			traceSchemaVersion: 1,
			sessionId: path.basename(dir),
			collectors: {
				blockThresholdMs: 20,
				lagIntervalMs: 1000,
				n1Threshold: 20,
			},
			blocking: {
				count: 1,
				totalMs: 9,
				calls: [
					{
						api: "readFileSync",
						count: 1,
						totalMs: 9,
						maxMs: 9,
						file: "src/index.ts",
						line: 3,
						column: 15,
						function: null,
						asyncRootType: "",
					},
				],
			},
			http: { requests: 0, endpoints: [] },
		})}\n`,
	);
	return dir;
}

test("scan --trace at a nonexistent directory is a usage error (AC-2)", () => {
	const missing = path.join(makeTmpDir(), "nope");
	const result = runCli(["scan", BAD_APP, "--trace", missing]);
	expect(result.exitCode).toBe(2);
	expect(result.stdout).toBe("");
	expect(result.stderr).toContain("trace directory does not exist");
});

test("scan --trace without findings.json is a usage error (AC-2)", () => {
	const empty = makeTmpDir();
	const result = runCli(["scan", BAD_APP, "--trace", empty]);
	expect(result.exitCode).toBe(2);
	expect(result.stdout).toBe("");
	expect(result.stderr).toContain("trace findings.json not found");
});

test("scan without --trace omits the runtime block entirely (AC-3)", () => {
	const result = runCli(["scan", BAD_APP, "--format", "json"]);
	expectSuccess(result, 0);
	const doc = JSON.parse(result.stdout) as Record<string, unknown>;
	expect(Object.keys(doc)).not.toContain("runtime");
});

test("scan --trace merges runtime diagnostics into the report (AC-1, AC-9, AC-11, AC-13)", () => {
	const sessionDir = seedSession();
	const result = runCli(["scan", BAD_APP, "--trace", sessionDir]);
	expectSuccess(result, 0);

	const out = result.stdout;
	expect(out).toContain(`Runtime trace: ${sessionDir}`);
	// The runtime row at the recorded culprit position…
	expect(out).toContain(
		"src/index.ts:3:15  warn  backend-doctor/runtime-blocking-call",
	);
	expect(out).toContain(
		"readFileSync blocked the event loop for up to 9ms (1 call(s), total 9ms)",
	);
	// …kept alongside the static diagnostic at the same site (AC-9)…
	expect(out).toContain("backend-doctor/no-eval");
	// …and all counted in the summary (4 static warns + 1 runtime warn).
	expect(out).toContain("Summary: 0 errors, 5 warnings (5 issues)");
});
