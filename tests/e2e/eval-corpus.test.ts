import path from "node:path";
import { describe, expect, it } from "vitest";
import { allProjectRules, allRules } from "../../src/engine/registry.js";
// Importing registers the product rules the coverage assertion needs.
import "../../src/rules/index.js";
import {
	BAD_APP_DIAGNOSTICS,
	BAD_APP_FILES,
	GOOD_APP_FILES,
} from "./goldens/eval-corpus.js";
import { expectSuccess, runCli } from "./helpers.js";

const GOOD_APP = path.resolve(import.meta.dirname, "../../evals/nest-good");
const BAD_APP = path.resolve(import.meta.dirname, "../../evals/nest-bad");

interface ReportDiagnostic {
	id: string;
	filePath: string;
	line: number;
	column: number;
	rule: string;
	category: string;
	severity: string;
	message: string;
	tags: string[];
}

interface ReportDocument {
	schemaVersion: number;
	mode: string;
	directory: string;
	diagnostics: ReportDiagnostic[];
	projects: Array<{
		packageRoot: string;
		frameworks: string[];
		analyzedFiles: string[];
		analyzedFileCount: number;
		complete: boolean;
		skippedChecks: Array<{ check: string; reason: string }>;
		nest?: unknown;
	}>;
}

function scanJson(app: string): { doc: ReportDocument; stdout: string } {
	const result = runCli(["scan", app, "--format", "json"]);
	expectSuccess(result, 0);
	return {
		doc: JSON.parse(result.stdout) as ReportDocument,
		stdout: result.stdout,
	};
}

describe("e2e: eval corpus — nest-good (spec 022 AC-1, AC-2, AC-7)", () => {
	it("scans clean: zero diagnostics, exit 0, empty stderr", () => {
		const result = runCli(["scan", GOOD_APP, "--format", "json"]);
		expectSuccess(result, 0);

		const doc = JSON.parse(result.stdout) as ReportDocument;
		expect(doc.diagnostics).toEqual([]);
	});

	it("projects[] matches the golden shape", () => {
		const { doc } = scanJson(GOOD_APP);
		expect(doc.projects).toHaveLength(1);
		const project = doc.projects[0];
		if (!project) throw new Error("unreachable");

		// The precision gate covers the default configuration: a crashed rule
		// or a skipped file must surface here, not silently (constitution §8).
		expect(project.skippedChecks).toEqual([]);
		expect(project.frameworks).toEqual(["nest", "prisma"]);
		expect(project.packageRoot).toBe(GOOD_APP);
		expect(project.complete).toBe(true);
		expect(project.analyzedFiles).toEqual(GOOD_APP_FILES);
		expect(project.analyzedFileCount).toBe(GOOD_APP_FILES.length);
		expect(project.nest).toBeDefined();
	});

	it("two consecutive json scans are byte-identical", () => {
		const first = runCli(["scan", GOOD_APP, "--format", "json"]);
		const second = runCli(["scan", GOOD_APP, "--format", "json"]);
		expectSuccess(first, 0);
		expectSuccess(second, 0);
		expect(second.stdout).toBe(first.stdout);
	});
});

describe("e2e: eval corpus — nest-bad (spec 022 AC-3, AC-4, AC-7)", () => {
	it("matches the golden diagnostic set exactly, exit 0 on warn-only", () => {
		const result = runCli(["scan", BAD_APP, "--format", "json"]);
		expectSuccess(result, 0);

		const doc = JSON.parse(result.stdout) as ReportDocument;
		const actual = doc.diagnostics.map((d) => ({
			file: path.relative(BAD_APP, d.filePath).split(path.sep).join("/"),
			line: d.line,
			column: d.column,
			rule: d.rule,
			category: d.category,
			severity: d.severity,
		}));
		expect(actual).toEqual(BAD_APP_DIAGNOSTICS);
		// Every corpus finding is warn-severity: the bad app is the recall
		// catalog, not a crash (exit 0 asserted by expectSuccess above).
		for (const diagnostic of doc.diagnostics) {
			expect(diagnostic.severity).toBe("warn");
			expect(diagnostic.tags).toEqual([]);
		}
	});

	it("projects[] matches the golden shape", () => {
		const { doc } = scanJson(BAD_APP);
		expect(doc.projects).toHaveLength(1);
		const project = doc.projects[0];
		if (!project) throw new Error("unreachable");

		expect(project.skippedChecks).toEqual([]);
		expect(project.frameworks).toEqual(["nest", "prisma"]);
		expect(project.packageRoot).toBe(BAD_APP);
		expect(project.complete).toBe(true);
		expect(project.analyzedFiles).toEqual(BAD_APP_FILES);
		expect(project.analyzedFileCount).toBe(BAD_APP_FILES.length);
		expect(project.nest).toBeDefined();
	});

	it("two consecutive json scans are byte-identical", () => {
		const first = runCli(["scan", BAD_APP, "--format", "json"]);
		const second = runCli(["scan", BAD_APP, "--format", "json"]);
		expectSuccess(first, 0);
		expectSuccess(second, 0);
		expect(second.stdout).toBe(first.stdout);
	});
});

describe("e2e: eval corpus — coverage and jsonl (spec 022 AC-5, AC-6)", () => {
	it("fires every registered rule at least once across the corpus", () => {
		const registered = new Set(
			[...allRules(), ...allProjectRules()].map((rule) => rule.id),
		);
		const fired = new Set(BAD_APP_DIAGNOSTICS.map((d) => d.rule));
		const missing = [...registered].filter((id) => !fired.has(id));
		expect(
			missing,
			"rules with no corpus firing site — extend evals/nest-bad",
		).toEqual([]);
	});

	it("jsonl prints one diagnostic per line with the pinned key order", () => {
		const result = runCli(["scan", BAD_APP, "--format", "jsonl"]);
		expectSuccess(result, 0);

		const lines = result.stdout.trimEnd().split("\n");
		expect(lines).toHaveLength(BAD_APP_DIAGNOSTICS.length);
		const keys = [
			"id",
			"filePath",
			"line",
			"column",
			"rule",
			"category",
			"severity",
			"message",
			"tags",
		];
		for (const line of lines) {
			expect(Object.keys(JSON.parse(line) as Record<string, unknown>)).toEqual(
				keys,
			);
		}

		const clean = runCli(["scan", GOOD_APP, "--format", "jsonl"]);
		expectSuccess(clean, 0);
		expect(clean.stdout).toBe("");
	});
});
