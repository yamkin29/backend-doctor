import path from "node:path";
import { describe, expect, it } from "vitest";
import {
	commitAll,
	makeTempDir,
	makeTempRepo,
	writeFiles,
} from "../unit/scope/git-test-support.js";
import { expectSuccess, makeTmpDir, runCli } from "./helpers.js";

interface ReportJson {
	mode: string;
	scope?: { base: string };
	diagnostics: {
		id: string;
		filePath: string;
		line: number;
		rule: string;
		severity: string;
	}[];
	projects: {
		analyzedFiles: string[];
		analyzedFileCount: number;
		complete: boolean;
		skippedChecks: { check: string; reason: string }[];
	}[];
}

function evalFile(label: string): string {
	return ["export function f(): void {", `\teval("${label}");`, "}"].join("\n");
}

const TOUCHED_BEFORE = [
	"export function f(): void {",
	'\teval("1");',
	"void 1;",
	"void 2;",
	"void 3;",
	'\teval("2");',
	"}",
].join("\n");

const TOUCHED_AFTER = TOUCHED_BEFORE.replace('eval("1")', 'eval("changed")');

/** Committed bad app, then dirt: one tracked edit, one untracked file. */
function makeDirtyRepo(withSubdir = false): string {
	const repo = makeTempRepo();
	writeFiles(repo, {
		"package.json": JSON.stringify({
			name: "app",
			dependencies: { "left-pad": "^1.3.0" },
		}),
		".gitignore": "ignored.ts\n",
		"src/touched.ts": TOUCHED_BEFORE,
		"src/untouched.ts": evalFile("untouched"),
		"src/base.ts": evalFile("base"),
		...(withSubdir ? { "sub/inner.ts": evalFile("inner") } : {}),
	});
	commitAll(repo, "base");
	writeFiles(repo, {
		"src/touched.ts": TOUCHED_AFTER,
		"src/new.ts": evalFile("new"),
		"ignored.ts": evalFile("ignored"),
		...(withSubdir ? { "sub/inner.ts": evalFile("inner-changed") } : {}),
	});
	return repo;
}

function scanJson(args: string[]): {
	result: ReturnType<typeof runCli>;
	report: ReportJson;
} {
	const result = runCli(["scan", ...args]);
	expect(result.stdout, result.stderr).not.toBe("");
	return { result, report: JSON.parse(result.stdout) as ReportJson };
}

// ---------------------------------------------------------------------------
// AC-1..AC-12 (spec 015). AC-8 lives in the flag-validation describe above;
// AC-6/AC-9/AC-11 are asserted inside the scenario runs.
// ---------------------------------------------------------------------------

describe("default scope keeps the pre-015 behavior (AC-1)", () => {
	it("runs the full pipeline: mode full, project rules present, complete", () => {
		const repo = makeDirtyRepo();
		const { result, report } = scanJson([repo, "--format", "json"]);
		expectSuccess(result);
		expect(report.mode).toBe("full");
		expect(report.scope).toBeUndefined();
		expect(report.projects[0]?.complete).toBe(true);
		expect(
			report.projects[0]?.skippedChecks.filter(
				(entry) => entry.check === "project-rules",
			),
		).toEqual([]);
		// The project pass ran: the planted unused dependency is reported.
		expect(
			report.diagnostics.some(
				(d) => d.rule === "backend-doctor/unused-dependency",
			),
		).toBe(true);
	});
});

describe("--scope changed (AC-2, AC-9, AC-11)", () => {
	it("restricts analysis to the changed set and degrades loudly", () => {
		const repo = makeDirtyRepo();
		const { result, report } = scanJson([
			repo,
			"--scope",
			"changed",
			"--format",
			"json",
		]);
		expectSuccess(result); // stderr empty, exit 0 (warnings only, AC-11)
		expect(report.mode).toBe("changed");
		expect(report.scope).toEqual({ base: "HEAD" });
		expect(report.projects[0]?.analyzedFiles.sort()).toEqual([
			"src/new.ts",
			"src/touched.ts",
		]);
		expect(report.projects[0]?.analyzedFileCount).toBe(2);
		expect(report.projects[0]?.complete).toBe(false);
		expect(report.projects[0]?.skippedChecks).toEqual([
			{
				check: "project-rules",
				reason: expect.stringContaining("changed"),
			},
		]);
		// No findings from unchanged or ignored files, no project findings.
		const offenders = report.diagnostics.filter((d) => {
			const rel = path.relative(repo, d.filePath);
			return (
				rel === "src/untouched.ts" ||
				rel === "src/base.ts" ||
				rel === "ignored.ts" ||
				d.rule === "backend-doctor/unused-dependency"
			);
		});
		expect(offenders).toEqual([]);
	});
});

describe("--scope lines (AC-3, AC-6)", () => {
	it("keeps only in-hunk diagnostics; untracked files stay whole", () => {
		const repo = makeDirtyRepo();
		const { report } = scanJson([repo, "--scope", "lines", "--format", "json"]);
		expect(report.mode).toBe("lines");
		expect(report.scope).toEqual({ base: "HEAD" });
		const touched = report.diagnostics.filter((d) =>
			d.filePath.endsWith("src/touched.ts"),
		);
		// Line 2 is inside the edited hunk; line 6 is outside and filtered.
		expect(touched.map((d) => d.line)).toEqual([2]);
		expect(
			report.diagnostics.filter((d) => d.filePath.endsWith("src/new.ts")),
		).toHaveLength(1);
	});

	it("is byte-identical across two runs on an unchanged tree (AC-6)", () => {
		const repo = makeDirtyRepo();
		const first = runCli([repo, "--scope", "lines", "--format", "json"]);
		const second = runCli([repo, "--scope", "lines", "--format", "json"]);
		expect(first.stdout).toBe(second.stdout);
		expect(first.exitCode).toBe(second.exitCode);
	});
});

describe("diagnostic id stability across scopes (AC-5)", () => {
	it("reports the same id in full, changed and lines runs", () => {
		const repo = makeDirtyRepo();
		const idFrom = (args: string[]): string => {
			const { report } = scanJson([repo, ...args]);
			const finding = report.diagnostics.find(
				(d) => d.filePath.endsWith("src/touched.ts") && d.line === 2,
			);
			expect(finding).toBeDefined();
			return finding?.id ?? "";
		};
		const full = idFrom(["--format", "json"]);
		const changed = idFrom(["--scope", "changed", "--format", "json"]);
		const lines = idFrom(["--scope", "lines", "--format", "json"]);
		expect(full).toBe(changed);
		expect(full).toBe(lines);
	});
});

describe("--scope files (AC-4)", () => {
	it("analyzes exactly the listed files", () => {
		const repo = makeDirtyRepo();
		const { result, report } = scanJson([
			repo,
			"--scope",
			"files",
			// The approved contract resolves --file against the process cwd;
			// the e2e spawn cwd is this repo, so the subset is given in
			// absolute form.
			"--file",
			path.join(repo, "src/new.ts"),
			"--file",
			path.join(repo, "src/base.ts"),
			"--format",
			"json",
		]);
		expectSuccess(result);
		expect(report.mode).toBe("files");
		expect(report.scope).toBeUndefined();
		expect(report.projects[0]?.analyzedFiles.sort()).toEqual([
			"src/base.ts",
			"src/new.ts",
		]);
		expect(
			report.diagnostics.map((d) => path.relative(repo, d.filePath)).sort(),
		).toEqual(["src/base.ts", "src/new.ts"]);
	});
});

describe("scope error paths (AC-7)", () => {
	it("exits 2 outside a git work tree", () => {
		const dir = makeTempDir();
		const result = runCli(["scan", dir, "--scope", "changed"]);
		expect(result.exitCode).toBe(2);
		expect(result.stderr).toContain("git work tree");
		expect(result.stdout).toBe("");
	});

	it("exits 2 when --base does not resolve", () => {
		const repo = makeDirtyRepo();
		const result = runCli([
			"scan",
			repo,
			"--scope",
			"changed",
			"--base",
			"no-such-ref",
		]);
		expect(result.exitCode).toBe(2);
		expect(result.stderr).toContain("no-such-ref");
		expect(result.stdout).toBe("");
	});

	it("exits 2 when git is not executable", () => {
		const repo = makeDirtyRepo();
		const result = runCli(["scan", repo, "--scope", "changed"], {
			env: { PATH: "" },
		});
		expect(result.exitCode).toBe(2);
		expect(result.stderr).toContain("git");
		expect(result.stdout).toBe("");
	});
});

describe("subdirectory target (AC-10)", () => {
	it("ignores changes outside the target subtree", () => {
		const repo = makeDirtyRepo(true);
		const { result, report } = scanJson([
			path.join(repo, "sub"),
			"--scope",
			"changed",
			"--format",
			"json",
		]);
		expectSuccess(result);
		expect(report.mode).toBe("changed");
		expect(report.projects[0]?.analyzedFiles).toEqual(["inner.ts"]);
		expect(
			report.diagnostics.map((d) => [path.relative(repo, d.filePath), d.line]),
		).toEqual([["sub/inner.ts", 2]]);
	});
});

describe("error-severity findings still exit 1 (AC-11)", () => {
	it("applies the exit-code policy to the scoped output", () => {
		const repo = makeTempRepo();
		writeFiles(repo, {
			"package.json": JSON.stringify({ name: "app" }),
			"backend-doctor.config.json": JSON.stringify({
				rules: { "backend-doctor/no-eval": "error" },
			}),
			"src/a.ts": evalFile("a"),
		});
		commitAll(repo, "base");
		writeFiles(repo, { "src/a.ts": `${evalFile("a")}\nexport const b = 1;\n` });

		const result = runCli([
			"scan",
			repo,
			"--scope",
			"changed",
			"--format",
			"json",
		]);
		expect(result.exitCode).toBe(1);
		expect(result.stderr).toBe("");
		const report = JSON.parse(result.stdout) as ReportJson;
		expect(report.diagnostics[0]?.severity).toBe("error");
	});
});

describe("unborn HEAD (AC-12)", () => {
	it("treats every collected file as changed in a fresh repo", () => {
		const repo = makeTempRepo(); // git init, no commits
		writeFiles(repo, {
			"src/a.ts": evalFile("a"),
			"src/b.ts": evalFile("b"),
		});
		const { result, report } = scanJson([
			repo,
			"--scope",
			"changed",
			"--format",
			"json",
		]);
		expectSuccess(result);
		expect(report.mode).toBe("changed");
		expect(report.projects[0]?.analyzedFiles.sort()).toEqual([
			"src/a.ts",
			"src/b.ts",
		]);
	});
});

describe("scope flag validation (spec 015 AC-8)", () => {
	it("exits 2 when --scope files has no --file", () => {
		const dir = makeTmpDir();
		const result = runCli(["scan", dir, "--scope", "files"]);
		expect(result.exitCode).toBe(2);
		expect(result.stderr).toContain("--file");
		expect(result.stdout).toBe("");
	});

	it("exits 2 when --file is used without --scope files", () => {
		const dir = makeTmpDir();
		const result = runCli(["scan", dir, "--file", "src/a.ts"]);
		expect(result.exitCode).toBe(2);
		expect(result.stderr).toContain("--scope files");
		expect(result.stdout).toBe("");
	});

	it("exits 2 for an unknown --scope value", () => {
		const dir = makeTmpDir();
		const result = runCli(["scan", dir, "--scope", "bogus"]);
		expect(result.exitCode).toBe(2);
		expect(result.stderr).not.toBe("");
		expect(result.stdout).toBe("");
	});
});
