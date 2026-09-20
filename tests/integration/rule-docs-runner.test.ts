import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Spec 017 AC-9: the maintainer runner built from the second tsup entry
 * (`dist/scripts/rule-docs.js`, produced by the vitest globalSetup build).
 * Every test runs it with cwd = a temp directory, so the real repo tree is
 * never mutated.
 */
const runnerPath = path.resolve(
	fileURLToPath(import.meta.url),
	"../../../dist/scripts/rule-docs.js",
);

interface RunnerResult {
	stdout: string;
	stderr: string;
	status: number;
}

function runRunner(args: string[], cwd: string): RunnerResult {
	const res = spawnSync(process.execPath, [runnerPath, ...args], {
		encoding: "utf8",
		cwd,
	});
	return {
		stdout: res.stdout ?? "",
		stderr: res.stderr ?? "",
		status: res.status ?? -1,
	};
}

function makeCwd(): string {
	return fs.mkdtempSync(path.join(os.tmpdir(), "rule-docs-runner-"));
}

function seedRealDocsTree(cwd: string): void {
	// --check validates the whole registry, so a clean tree is a copy of the
	// repo's own docs/rules (currently green per the T4 gate).
	fs.cpSync(
		path.resolve(import.meta.dirname, "../../docs/rules"),
		path.join(cwd, "docs", "rules"),
		{ recursive: true },
	);
}

describe("rule-docs runner (spec 017 AC-9)", () => {
	it("--scaffold creates the doc for a registered rule and exits 0", () => {
		const cwd = makeCwd();
		const result = runRunner(["--scaffold", "backend-doctor/no-eval"], cwd);
		expect(result.status).toBe(0);
		const filePath = path.join(
			cwd,
			"docs",
			"rules",
			"backend-doctor",
			"no-eval.md",
		);
		expect(result.stdout).toContain(filePath);
		const content = fs.readFileSync(filePath, "utf8");
		expect(content).toContain("# backend-doctor/no-eval");
		expect(content).toContain("- **Category:** Security");
		expect(content).toContain("- **Default severity:** `warn`");
		expect(content).toContain("TODO");
	});

	it("--scaffold refuses to overwrite and exits 2 with the file untouched", () => {
		const cwd = makeCwd();
		const first = runRunner(["--scaffold", "backend-doctor/no-eval"], cwd);
		expect(first.status).toBe(0);
		const filePath = path.join(
			cwd,
			"docs",
			"rules",
			"backend-doctor",
			"no-eval.md",
		);
		const before = fs.readFileSync(filePath, "utf8");
		const second = runRunner(["--scaffold", "backend-doctor/no-eval"], cwd);
		expect(second.status).toBe(2);
		expect(second.stderr).toContain("already exists");
		expect(second.stderr).toContain(filePath);
		expect(fs.readFileSync(filePath, "utf8")).toBe(before);
	});

	it("--scaffold exits 2 for an unregistered id", () => {
		const cwd = makeCwd();
		const result = runRunner(
			["--scaffold", "backend-doctor/does-not-exist"],
			cwd,
		);
		expect(result.status).toBe(2);
		expect(result.stderr).toContain("backend-doctor/does-not-exist");
	});

	it("--check exits 0 on a copy of the real, consistent docs tree", () => {
		const cwd = makeCwd();
		seedRealDocsTree(cwd);
		const result = runRunner(["--check"], cwd);
		expect(result.status).toBe(0);
		expect(result.stderr).toBe("");
		expect(result.stdout).toContain("ok");
	});

	it("--check exits 1 and names violations on a drifted tree", () => {
		const cwd = makeCwd();
		seedRealDocsTree(cwd);
		fs.writeFileSync(
			path.join(cwd, "docs", "rules", "backend-doctor", "orphan.md"),
			"# stray\n",
		);
		const result = runRunner(["--check"], cwd);
		expect(result.status).toBe(1);
		expect(result.stdout).toContain("orphan.md");
	});

	it("exits 2 with usage on stderr for unknown or missing flags", () => {
		const cwd = makeCwd();
		expect(runRunner([], cwd).status).toBe(2);
		const unknown = runRunner(["--wat"], cwd);
		expect(unknown.status).toBe(2);
		expect(unknown.stderr).toContain("usage:");
	});
});
