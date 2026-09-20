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
import { noCommandInjection } from "../../../src/rules/security/no-command-injection.js";
import { noEval } from "../../../src/rules/security/no-eval.js";
import { noNewFunc } from "../../../src/rules/security/no-new-func.js";

const FIXTURE_ROOT = path.resolve(
	import.meta.dirname,
	"../../fixtures/backend-doctor",
);

/** Short fixture id → rule under test (grows with each rule task). */
const rules: Record<string, RuleDefinition> = {
	"no-eval": noEval,
	"no-new-func": noNewFunc,
	"no-command-injection": noCommandInjection,
};

/** Runs one rule over a fixture directory using the real parser adapter. */
function scanFixture(shortId: string, fixtureName: string): Diagnostic[] {
	const rule = rules[shortId];
	if (!rule) throw new Error(`no rule registered for "${shortId}"`);
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
				detectedFrameworks: [],
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

describe("backend-doctor/no-command-injection (AC-1..2)", () => {
	const message =
		"This shell command is built dynamically, so request data can change what executes. Pass an argument array to execFile or spawn instead of interpolating input into an exec string.";

	it("flags dynamic exec/execSync commands with exact diagnostics (AC-1)", () => {
		expect(
			summarize(
				scanFixture("no-command-injection", "no-command-injection/invalid"),
			),
		).toEqual([
			{
				file: path.join(
					"no-command-injection",
					"invalid",
					"bare-identifier.ts",
				),
				line: 4,
				column: 2,
				message,
				severity: "warn",
				category: "Security",
			},
			{
				file: path.join("no-command-injection", "invalid", "concat-sync.ts"),
				line: 4,
				column: 9,
				message,
				severity: "warn",
				category: "Security",
			},
			{
				file: path.join("no-command-injection", "invalid", "template-exec.ts"),
				line: 4,
				column: 2,
				message,
				severity: "warn",
				category: "Security",
			},
		]);
	});

	it("stays silent on literals, spawn, shadows and non-child-process files (AC-2)", () => {
		expect(
			scanFixture("no-command-injection", "no-command-injection/valid"),
		).toEqual([]);
	});
});
