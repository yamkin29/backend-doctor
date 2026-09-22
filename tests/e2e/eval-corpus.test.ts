import path from "node:path";
import { describe, expect, it } from "vitest";
import { GOOD_APP_FILES } from "./goldens/eval-corpus.js";
import { expectSuccess, runCli } from "./helpers.js";

const GOOD_APP = path.resolve(import.meta.dirname, "../../evals/nest-good");

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
