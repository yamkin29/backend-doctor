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
import { noSyncFsInRequestPath } from "../../../src/rules/blocking/sync-fs.js";
// Importing registers the product rules (src/rules/index.ts is the explicit,
// greppable registry) so the AC-9 registry assertion sees them.
import "../../../src/rules/index.js";

const FIXTURE_ROOT = path.resolve(
	import.meta.dirname,
	"../../fixtures/backend-doctor",
);

/** Short fixture id → rule under test (grows with each rule task). */
const rules: Record<string, RuleDefinition> = {
	"no-sync-fs-in-request-path": noSyncFsInRequestPath,
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

describe("backend-doctor/no-sync-fs-in-request-path (AC-1..3)", () => {
	const message =
		"Synchronous fs calls block the event loop for the whole I/O, stalling every concurrent request. Use the promise API (fs/promises) or await fs.promises instead.";

	it("flags sync fs calls inside function bodies with exact diagnostics (AC-1)", () => {
		expect(
			summarize(
				scanFixture(
					"no-sync-fs-in-request-path",
					"no-sync-fs-in-request-path/invalid",
				),
			),
		).toEqual([
			{
				file: path.join(
					"no-sync-fs-in-request-path",
					"invalid",
					"named-import.ts",
				),
				line: 4,
				column: 9,
				message,
				severity: "warn",
				category: "Performance",
			},
			{
				file: path.join(
					"no-sync-fs-in-request-path",
					"invalid",
					"nested-function.ts",
				),
				line: 4,
				column: 15,
				message,
				severity: "warn",
				category: "Performance",
			},
			{
				file: path.join(
					"no-sync-fs-in-request-path",
					"invalid",
					"property-fs.ts",
				),
				line: 4,
				column: 9,
				message,
				severity: "warn",
				category: "Performance",
			},
		]);
	});

	it("stays silent at top level, on promise APIs, shadows and non-fs imports (AC-2..3)", () => {
		expect(
			scanFixture(
				"no-sync-fs-in-request-path",
				"no-sync-fs-in-request-path/valid",
			),
		).toEqual([]);
	});
});
