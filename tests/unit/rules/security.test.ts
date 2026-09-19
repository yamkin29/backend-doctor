import path from "node:path";
import { describe, expect, it } from "vitest";
import { defaultConfig } from "../../../src/config/types.js";
import type { Diagnostic } from "../../../src/core/types.js";
import {
	collectFiles,
	SUPPORTED_EXTENSIONS,
} from "../../../src/engine/collect.js";
import { TsMorphParserAdapter } from "../../../src/engine/parser/ts-morph-adapter.js";
import { runRules } from "../../../src/engine/runner.js";
import { noEval } from "../../../src/rules/security/no-eval.js";
import { noNewFunc } from "../../../src/rules/security/no-new-func.js";

const FIXTURE_ROOT = path.resolve(
	import.meta.dirname,
	"../../fixtures/backend-doctor",
);

/** Runs one rule over a fixture directory using the real parser adapter. */
function scanFixture(ruleId: string, fixtureName: string): Diagnostic[] {
	const rule = ruleId === "no-eval" ? noEval : noNewFunc;
	const target = path.join(FIXTURE_ROOT, fixtureName);
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
			}).diagnostics,
		);
	}
	return diagnostics;
}

function summarize(diagnostics: Diagnostic[]) {
	return diagnostics.map((d) => ({
		file: path.relative(FIXTURE_ROOT, d.filePath),
		line: d.line,
		column: d.column,
		message: d.message,
		severity: d.severity,
		category: d.category,
	}));
}

describe("backend-doctor/no-eval (AC-3)", () => {
	it("flags direct, indirect and globalThis eval with exact diagnostics", () => {
		expect(summarize(scanFixture("no-eval", "no-eval/invalid"))).toEqual([
			{
				file: path.join("no-eval", "invalid", "direct.ts"),
				line: 1,
				column: 1,
				message:
					"Prefer safer alternatives instead of eval(); it executes arbitrary code.",
				severity: "warn",
				category: "Security",
			},
			{
				file: path.join("no-eval", "invalid", "global-this.ts"),
				line: 1,
				column: 1,
				message:
					"Prefer safer alternatives instead of eval(); it executes arbitrary code.",
				severity: "warn",
				category: "Security",
			},
			{
				file: path.join("no-eval", "invalid", "indirect.ts"),
				line: 1,
				column: 1,
				message:
					"Prefer safer alternatives instead of eval(); it executes arbitrary code.",
				severity: "warn",
				category: "Security",
			},
		]);
	});

	it("stays silent on false-positive-prone valid fixtures", () => {
		expect(scanFixture("no-eval", "no-eval/valid")).toEqual([]);
	});
});

describe("backend-doctor/no-new-func (AC-3)", () => {
	it("flags new Function with an exact diagnostic", () => {
		expect(
			summarize(scanFixture("no-new-func", "no-new-func/invalid")),
		).toEqual([
			{
				file: path.join("no-new-func", "invalid", "direct.ts"),
				line: 1,
				column: 1,
				message:
					"Prefer explicit code instead of new Function(); it compiles arbitrary code at runtime.",
				severity: "warn",
				category: "Security",
			},
		]);
	});

	it("stays silent on false-positive-prone valid fixtures", () => {
		expect(scanFixture("no-new-func", "no-new-func/valid")).toEqual([]);
	});
});
