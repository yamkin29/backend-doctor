import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { defaultConfig } from "../../../src/config/types.js";
import type { Diagnostic } from "../../../src/core/types.js";
import {
	collectFiles,
	SUPPORTED_EXTENSIONS,
} from "../../../src/engine/collect.js";
import { TsMorphParserAdapter } from "../../../src/engine/parser/ts-morph-adapter.js";
import type { RuleDefinition } from "../../../src/engine/registry.js";
import { runRules } from "../../../src/engine/runner.js";
import { noEmptyCatch } from "../../../src/rules/errors/no-empty-catch.js";

const REPO_ROOT = path.resolve(import.meta.dirname, "../../..");
const FLAT_ROOT = path.resolve(
	import.meta.dirname,
	"../../fixtures/backend-doctor",
);
const NEST_ROOT = path.resolve(
	import.meta.dirname,
	"../../fixtures/nest/errors-lifecycle",
);

/** Short fixture id → rule under test (grows with each rule task). */
const rulesById: Record<string, RuleDefinition> = {
	"no-empty-catch": noEmptyCatch,
};

/** Runs one framework-free rule over a flat fixture directory. */
function scanFixture(shortId: string, fixtureName: string): Diagnostic[] {
	const rule = rulesById[shortId];
	if (!rule) throw new Error(`no rule registered for "${shortId}"`);
	const target = path.join(FLAT_ROOT, fixtureName);
	const files = collectFiles({
		target,
		extensions: SUPPORTED_EXTENSIONS,
		excludes: [],
		ignoreGlobs: [],
	});
	const adapter = new TsMorphParserAdapter();
	const { files: views } = adapter.createProject(files);

	const diagnostics: Diagnostic[] = [];
	for (const view of views) {
		diagnostics.push(
			...runRules({
				file: view,
				rules: [rule],
				config: defaultConfig(),
				adapter,
				scanRoot: target,
				detectedFrameworks: [],
			}).diagnostics,
		);
	}
	return diagnostics;
}

function summarize(diagnostics: Diagnostic[]) {
	return diagnostics.map((d) => ({
		file: path.relative(FLAT_ROOT, d.filePath),
		line: d.line,
		column: d.column,
		message: d.message,
		severity: d.severity,
		category: d.category,
	}));
}

const EMPTY_CATCH_MESSAGE =
	"This catch block is empty: the error disappears without a trace. Handle it, rethrow it, or write the reason for the deliberate ignore as a comment inside the block.";

describe("backend-doctor/no-empty-catch (AC-1, AC-5, AC-9)", () => {
	it("flags empty catch bodies with exact diagnostics (AC-1)", () => {
		expect(
			summarize(scanFixture("no-empty-catch", "no-empty-catch/invalid")),
		).toEqual([
			{
				file: path.join("no-empty-catch", "invalid", "bare.ts"),
				line: 4,
				column: 4,
				message: EMPTY_CATCH_MESSAGE,
				severity: "warn",
				category: "Bugs",
			},
			{
				file: path.join("no-empty-catch", "invalid", "outside-comment.ts"),
				line: 4,
				column: 4,
				message: EMPTY_CATCH_MESSAGE,
				severity: "warn",
				category: "Bugs",
			},
		]);
	});

	it("stays silent on handled, rethrown and comment-documented catches (AC-1, AC-5)", () => {
		expect(scanFixture("no-empty-catch", "no-empty-catch/valid")).toEqual([]);
	});

	it("ships valid/invalid fixtures and a rule doc (AC-9)", () => {
		for (const dir of ["valid", "invalid"]) {
			expect(
				fs.existsSync(path.join(FLAT_ROOT, "no-empty-catch", dir)),
				dir,
			).toBe(true);
		}
		expect(
			fs.existsSync(path.join(REPO_ROOT, noEmptyCatch.docs)),
			noEmptyCatch.docs,
		).toBe(true);
	});
});
