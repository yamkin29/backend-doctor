import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ReportDocument } from "../../src/core/types.js";
import {
	commitAll,
	git,
	makeTempRepo,
	writeFiles,
} from "../unit/scope/git-test-support.js";
import { makeTmpDir, runCli } from "./helpers.js";

describe("introduced scope CLI (spec 030)", () => {
	const dirs: string[] = [];
	afterEach(() => {
		for (const dir of dirs.splice(0))
			fs.rmSync(dir, { recursive: true, force: true });
	});
	function repo(source = 'eval("old");\n', commit = true) {
		const dir = fs.realpathSync(makeTempRepo());
		dirs.push(dir);
		writeFiles(dir, { "package.json": '{"name":"test"}', "a.ts": source });
		if (commit) commitAll(dir, "base");
		return dir;
	}
	function scan(dir: string, extra: string[] = []) {
		const result = runCli([
			"scan",
			dir,
			"--scope",
			"introduced",
			"--format",
			"json",
			...extra,
		]);
		expect(result.stderr).toBe("");
		return { result, report: JSON.parse(result.stdout) as ReportDocument };
	}
	it("reports only introduced findings, preserves IDs, coverage, schema and determinism", () => {
		const dir = repo();
		writeFiles(dir, { "a.ts": '// shift\neval("old");\neval("new");\n' });
		const first = scan(dir);
		const second = scan(dir);
		expect(first.result.stdout).toBe(second.result.stdout);
		expect(first.report.mode).toBe("introduced");
		expect(first.report.schemaVersion).toBe(1);
		expect(first.report.scope).toEqual({ base: "HEAD" });
		expect(first.report.diagnostics.map((d) => d.line)).toEqual([3]);
		expect(first.report.projects[0]?.complete).toBe(false);
		expect(first.report.projects[0]?.skippedChecks).toContainEqual({
			check: "project-rules",
			reason: expect.stringContaining("introduced"),
		});
		const full = JSON.parse(
			runCli(["scan", dir, "--format", "json"]).stdout,
		) as ReportDocument;
		expect(first.report.diagnostics[0]).toEqual(
			full.diagnostics.find((d) => d.line === 3),
		);
		expect(first.result.exitCode).toBe(0);
	});
	it("omits unchanged error findings, then returns 1 for a new error", () => {
		const dir = repo();
		writeFiles(dir, {
			"backend-doctor.config.json":
				'{"rules":{"backend-doctor/no-eval":"error"}}',
			"a.ts": '// shift\neval("old");\n',
		});
		expect(scan(dir).result.exitCode).toBe(0);
		writeFiles(dir, { "a.ts": '// shift\neval("old");\neval("new");\n' });
		expect(scan(dir).result.exitCode).toBe(1);
	});
	it("supports empty and unborn repositories, untracked sources, JSONL and pretty output", () => {
		const dir = repo('eval("new");', false);
		expect(scan(dir).report.diagnostics).toHaveLength(1);
		commitAll(dir, "initial");
		expect(scan(dir).report.diagnostics).toEqual([]);
		writeFiles(dir, { "untracked.ts": 'eval("new");' });
		const jsonl = runCli([
			"scan",
			dir,
			"--scope",
			"introduced",
			"--format",
			"jsonl",
		]);
		expect(JSON.parse(jsonl.stdout).rule).toBe("backend-doctor/no-eval");
		expect(jsonl.stderr).toBe("");
		const pretty = runCli([
			"scan",
			dir,
			"--scope",
			"introduced",
			"--no-interactive",
		]);
		expect(pretty.stdout).toContain("introduced mode");
	});
	it("includes staged source files before the first commit", () => {
		const dir = repo('eval("new");', false);
		git(dir, "add", "-A");
		expect(scan(dir).report.diagnostics).toHaveLength(1);
	});
	it("retains runtime evidence independently of the static comparison", () => {
		const dir = repo();
		const session = path.join(dir, "trace");
		writeFiles(dir, {
			"trace/session.json": JSON.stringify({
				traceSchemaVersion: 1,
				session: { cwd: dir },
			}),
			"trace/findings.json": JSON.stringify({
				traceSchemaVersion: 1,
				sessionId: "test",
				collectors: {
					blockThresholdMs: 20,
					lagIntervalMs: 1000,
					n1Threshold: 20,
				},
				blocking: {
					count: 1,
					totalMs: 30,
					calls: [
						{
							api: "readFileSync",
							count: 1,
							totalMs: 30,
							maxMs: 30,
							file: "a.ts",
							line: 1,
							column: 1,
							function: null,
							asyncRootType: "",
						},
					],
				},
				http: { requests: 0, endpoints: [] },
			}),
		});
		const { report } = scan(dir, ["--trace", session]);
		expect(report.diagnostics.map((d) => d.rule)).toEqual([
			"backend-doctor/runtime-blocking-call",
		]);
		expect(report.runtime?.sessionDir).toBe(session);
	});
	it("rejects invalid refs, non-repositories and explicit files without a misleading report", () => {
		const dir = repo();
		const outside = makeTmpDir();
		dirs.push(outside);
		for (const args of [
			[dir, "--base", "missing-ref"],
			[outside],
			[dir, "--file", path.join(dir, "a.ts")],
		]) {
			const result = runCli([
				"scan",
				...args,
				"--scope",
				"introduced",
				"--format",
				"json",
			]);
			expect(result.exitCode).toBe(2);
			expect(result.stdout).toBe("");
			expect(result.stderr).not.toBe("");
		}
	});
	it("explains baseline failures in JSON and pretty output without leaking temp paths", () => {
		const dir = repo("function bad( {");
		writeFiles(dir, { "a.ts": 'eval("new");' });
		const { report } = scan(dir);
		expect(report.projects[0]?.skippedChecks).toContainEqual({
			check: "baseline-comparison",
			reason: expect.stringContaining("unverified candidates"),
		});
		const pretty = runCli([
			"scan",
			dir,
			"--scope",
			"introduced",
			"--no-interactive",
		]);
		expect(pretty.stdout).toContain("not proven introduced");
		expect(pretty.stdout).not.toContain("bd-baseline-");
	});
});
