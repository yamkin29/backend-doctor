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
import { noDirectProcessEnv } from "../../../src/rules/config/no-direct-process-env.js";

const FIXTURE_ROOT = path.resolve(import.meta.dirname, "../../fixtures/config");

const CONFIG_ENV_MESSAGE =
	"process.env is read directly in business code; route the value through your config module so defaults and validation live in one place.";

/** Short fixture id → file rule under test (grows with each rule task). */
const rules: Record<string, RuleDefinition> = {
	"no-direct-process-env": noDirectProcessEnv,
};

/** Runs one file rule over a fixture directory using the real parser adapter. */
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

describe("backend-doctor/no-direct-process-env (AC-1)", () => {
	it("flags direct env access in business files with exact diagnostics", () => {
		expect(
			summarize(
				scanFixture("no-direct-process-env", "no-direct-process-env/invalid"),
			),
		).toEqual([
			{
				file: path.join("no-direct-process-env", "invalid", "users.service.ts"),
				line: 3,
				column: 17,
				message: CONFIG_ENV_MESSAGE,
				severity: "warn",
				category: "Configuration",
			},
			{
				file: path.join("no-direct-process-env", "invalid", "users.service.ts"),
				line: 7,
				column: 10,
				message: CONFIG_ENV_MESSAGE,
				severity: "warn",
				category: "Configuration",
			},
		]);
	});

	it("stays silent on config-shaped, test-shaped and whole-env files", () => {
		expect(
			scanFixture("no-direct-process-env", "no-direct-process-env/valid"),
		).toEqual([]);
	});
});
