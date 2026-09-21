import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { expectSuccess, makeTmpDir, runCli, runCliAsync } from "./helpers.js";

const repoRoot = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	"../..",
);
const BAD_APP = path.join(repoRoot, "tests/fixtures/engine/bad-app");
const fixturesDir = path.join(repoRoot, "tests/fixtures/probe");

function fixture(name: string): string {
	return path.join(fixturesDir, name);
}

/** tmpdir cwd in the realpath form the probe process itself reports. */
function tmpCwd(): string {
	return fs.realpathSync(makeTmpDir());
}

function soleSessionDir(cwd: string): string {
	const root = path.join(cwd, ".backend-doctor", "probe");
	const entries = fs.readdirSync(root);
	expect(entries, "exactly one session directory").toHaveLength(1);
	return path.join(root, entries[0] as string);
}

interface ReportJson {
	runtime?: { sessionDir: string; traceSchemaVersion: number };
	diagnostics: Array<{
		id: string;
		filePath: string;
		line: number;
		column: number;
		rule: string;
		category: string;
		severity: string;
		message: string;
		tags: string[];
	}>;
	projects: Array<{
		complete: boolean;
		skippedChecks: Array<{ check: string }>;
	}>;
}

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

test("full loop — probe blocking app, scan --trace merges the call site (AC-1, AC-4, AC-12)", async () => {
	const cwd = tmpCwd();
	fs.copyFileSync(fixture("blocking.cjs"), path.join(cwd, "blocking.cjs"));
	const probe = await runCliAsync(["probe", "--", "node", "blocking.cjs"], {
		cwd,
		env: { BACKEND_DOCTOR_PROBE_BLOCK_THRESHOLD_MS: "1" },
	});
	expect(probe.exitCode, probe.stderr).toBe(0);
	expect(probe.stdout).toBe("blocking-done 32\n");
	const sessionDir = soleSessionDir(cwd);

	const result = runCli([
		"scan",
		cwd,
		"--trace",
		sessionDir,
		"--format",
		"json",
	]);
	expectSuccess(result, 0);
	const doc = JSON.parse(result.stdout) as ReportJson;
	expect(doc.runtime).toEqual({ sessionDir, traceSchemaVersion: 1 });

	// The fixture's only collectable culprits are .cjs files, so the static
	// side is empty and every diagnostic is a runtime blocking-call row.
	expect(doc.diagnostics.length).toBeGreaterThanOrEqual(1);
	for (const d of doc.diagnostics) {
		expect(d.rule).toBe("backend-doctor/runtime-blocking-call");
		expect(d.category).toBe("Runtime");
		expect(d.severity).toBe("warn");
		expect(d.tags).toEqual(["runtime"]);
		// The hook recorded the culprit relative to the probe cwd; the merged
		// diagnostic resolves it back to the absolute file (spec 021 AC-4).
		expect(d.filePath).toBe(path.join(cwd, "blocking.cjs"));
		expect(typeof d.line).toBe("number");
		expect(typeof d.column).toBe("number");
		expect(d.message).toMatch(
			/^crypto\.pbkdf2Sync blocked the event loop for up to \d+(\.\d+)?ms \(\d+ call\(s\), total \d+(\.\d+)?ms\)$/,
		);
	}
}, 30000);

test("full loop — probe prisma app with a low N+1 knob, scan --trace merges the endpoint (AC-5)", async () => {
	const cwd = tmpCwd();
	const probe = await runCliAsync(
		["probe", "--", "node", fixture("prisma-app.cjs")],
		{ cwd, env: { BACKEND_DOCTOR_PROBE_N1_THRESHOLD: "2" } },
	);
	expect(probe.exitCode, probe.stderr).toBe(0);
	const sessionDir = soleSessionDir(cwd);

	const result = runCli([
		"scan",
		cwd,
		"--trace",
		sessionDir,
		"--format",
		"json",
	]);
	expectSuccess(result, 0);
	const doc = JSON.parse(result.stdout) as ReportJson;
	const n1 = doc.diagnostics.filter(
		(d) => d.rule === "backend-doctor/runtime-possible-n1",
	);
	expect(n1).toHaveLength(1);
	const findingsPath = path.join(sessionDir, "findings.json");
	expect(n1[0]?.filePath).toBe(findingsPath);
	expect(n1[0]?.line).toBe(1);
	expect(n1[0]?.column).toBe(1);
	expect(n1[0]?.message).toBe(
		"endpoint GET /bulk saw up to 3 db queries in one request (possible N+1)",
	);
	expect(n1[0]?.tags).toEqual(["runtime"]);
}, 30000);

test("full loop — merged ordering puts the out-of-root runtime row first (AC-8, AC-13)", async () => {
	const cwd = tmpCwd();
	fs.copyFileSync(fixture("blocking.cjs"), path.join(cwd, "blocking.cjs"));
	const probe = await runCliAsync(["probe", "--", "node", "blocking.cjs"], {
		cwd,
		env: { BACKEND_DOCTOR_PROBE_BLOCK_THRESHOLD_MS: "1" },
	});
	expect(probe.exitCode, probe.stderr).toBe(0);
	const sessionDir = soleSessionDir(cwd);

	const json = runCli([
		"scan",
		BAD_APP,
		"--trace",
		sessionDir,
		"--format",
		"json",
	]);
	expectSuccess(json, 0);
	const doc = JSON.parse(json.stdout) as ReportJson;
	expect(doc.diagnostics.map((d) => d.rule)).toEqual([
		"backend-doctor/runtime-blocking-call", // ../-relative culprit sorts first
		"backend-doctor/no-eval",
		"backend-doctor/no-new-func",
		"backend-doctor/unused-export",
		"backend-doctor/unused-file",
	]);
	expect(doc.runtime?.sessionDir).toBe(sessionDir);

	const jsonl = runCli([
		"scan",
		BAD_APP,
		"--trace",
		sessionDir,
		"--format",
		"jsonl",
	]);
	expectSuccess(jsonl, 0);
	const firstLine = JSON.parse(
		(jsonl.stdout.split("\n")[0] ?? "") as string,
	) as ReportJson["diagnostics"][number];
	expect(firstLine.rule).toBe("backend-doctor/runtime-blocking-call");
	expect(Object.keys(firstLine)).toEqual([
		"id",
		"filePath",
		"line",
		"column",
		"rule",
		"category",
		"severity",
		"message",
		"tags",
	]);

	const pretty = runCli(["scan", BAD_APP, "--trace", sessionDir]);
	expectSuccess(pretty, 0);
	expect(pretty.stdout).toContain(`Runtime trace: ${sessionDir}`);
}, 30000);

test("full loop — scope files keeps runtime diagnostics (AC-10)", async () => {
	const cwd = tmpCwd();
	fs.copyFileSync(fixture("blocking.cjs"), path.join(cwd, "blocking.cjs"));
	const probe = await runCliAsync(["probe", "--", "node", "blocking.cjs"], {
		cwd,
		env: { BACKEND_DOCTOR_PROBE_BLOCK_THRESHOLD_MS: "1" },
	});
	expect(probe.exitCode, probe.stderr).toBe(0);
	const sessionDir = soleSessionDir(cwd);

	const result = runCli([
		"scan",
		BAD_APP,
		"--scope",
		"files",
		"--file",
		path.join(BAD_APP, "src/index.ts"),
		"--trace",
		sessionDir,
		"--format",
		"json",
	]);
	expectSuccess(result, 0);
	const doc = JSON.parse(result.stdout) as ReportJson;
	// Static side is scoped to index.ts; project rules are skipped, visibly.
	expect(doc.projects[0]?.complete).toBe(false);
	expect(
		doc.projects[0]?.skippedChecks.some((s) => s.check === "project-rules"),
	).toBe(true);
	// Runtime diagnostics survive the scope untouched (spec 021 AC-10).
	expect(
		doc.diagnostics.some(
			(d) => d.rule === "backend-doctor/runtime-blocking-call",
		),
	).toBe(true);
}, 30000);
