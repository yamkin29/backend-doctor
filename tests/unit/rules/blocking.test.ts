import path from "node:path";
import { describe, expect, it } from "vitest";
import { defaultConfig } from "../../../src/config/types.js";
import type { Diagnostic } from "../../../src/core/types.js";
import {
	collectFiles,
	SUPPORTED_EXTENSIONS,
} from "../../../src/engine/collect.js";
import { TsMorphParserAdapter } from "../../../src/engine/parser/ts-morph-adapter.js";
import {
	allProjectRules,
	allRules,
	type RuleDefinition,
} from "../../../src/engine/registry.js";
import { runRules } from "../../../src/engine/runner.js";
import { noCpuBoundLoop } from "../../../src/rules/blocking/cpu-bound-loop.js";
import { noSyncCrypto } from "../../../src/rules/blocking/sync-crypto.js";
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
	"no-sync-crypto": noSyncCrypto,
	"no-cpu-bound-loop": noCpuBoundLoop,
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

describe("backend-doctor/no-sync-crypto (AC-4..6)", () => {
	const message =
		"Synchronous crypto work (key derivation, random bytes) blocks the event loop for the full computation. Use the callback or promisified async API instead.";

	it("flags sync crypto calls inside function bodies with exact diagnostics (AC-4..5)", () => {
		expect(
			summarize(scanFixture("no-sync-crypto", "no-sync-crypto/invalid")),
		).toEqual([
			{
				file: path.join("no-sync-crypto", "invalid", "pbkdf2-sync.ts"),
				line: 4,
				column: 9,
				message,
				severity: "warn",
				category: "Performance",
			},
			{
				file: path.join("no-sync-crypto", "invalid", "random-bytes-sync.ts"),
				line: 4,
				column: 9,
				message,
				severity: "warn",
				category: "Performance",
			},
			{
				file: path.join("no-sync-crypto", "invalid", "scrypt-sync.ts"),
				line: 4,
				column: 9,
				message,
				severity: "warn",
				category: "Performance",
			},
		]);
	});

	it("stays silent at top level, with callbacks, on promisified APIs and non-crypto imports (AC-5..6)", () => {
		expect(scanFixture("no-sync-crypto", "no-sync-crypto/valid")).toEqual([]);
	});
});

describe("backend-doctor/no-cpu-bound-loop (AC-7..8)", () => {
	const message =
		"This loop runs a literal-bounded body of at least 10,000 iterations without awaiting, so it blocks the event loop for the whole run. Move heavy CPU work off the request path or chunk it with setImmediate.";

	it("flags literal-bounded await-free loops with exact diagnostics (AC-7)", () => {
		expect(
			summarize(scanFixture("no-cpu-bound-loop", "no-cpu-bound-loop/invalid")),
		).toEqual([
			{
				file: path.join("no-cpu-bound-loop", "invalid", "do-while-literal.ts"),
				line: 4,
				column: 2,
				message,
				severity: "warn",
				category: "Performance",
			},
			{
				file: path.join("no-cpu-bound-loop", "invalid", "for-literal.ts"),
				line: 3,
				column: 2,
				message,
				severity: "warn",
				category: "Performance",
			},
			{
				file: path.join("no-cpu-bound-loop", "invalid", "while-literal.ts"),
				line: 4,
				column: 2,
				message,
				severity: "warn",
				category: "Performance",
			},
		]);
	});

	it("stays silent below the threshold, on awaits, variables and computed bounds (AC-8)", () => {
		expect(scanFixture("no-cpu-bound-loop", "no-cpu-bound-loop/valid")).toEqual(
			[],
		);
	});
});

describe("product registry (AC-13, spec 007)", () => {
	it("registers all product rules across the async, blocking and security packs", () => {
		const ids = [...allRules(), ...allProjectRules()].map((rule) => rule.id);
		for (const id of [
			"backend-doctor/no-sync-fs-in-request-path",
			"backend-doctor/no-sync-crypto",
			"backend-doctor/no-cpu-bound-loop",
			"backend-doctor/no-eval",
			"backend-doctor/no-new-func",
			"backend-doctor/no-floating-promises",
			"backend-doctor/no-async-constructor-work",
			"backend-doctor/no-async-foreach-callback",
			"backend-doctor/unhandled-json-parse",
			"backend-doctor/no-unhandled-emitter-error",
			"backend-doctor/no-command-injection",
			"backend-doctor/no-path-traversal",
			"backend-doctor/no-hardcoded-secrets",
			"backend-doctor/no-weak-crypto",
			"backend-doctor/no-ssrf",
			"backend-doctor/no-unsafe-merge",
			"backend-doctor/provider-not-registered",
			"backend-doctor/circular-di",
			"backend-doctor/missing-forward-ref",
			"backend-doctor/request-scoped-in-singleton",
		]) {
			expect(ids, id).toContain(id);
		}
		expect(ids).toHaveLength(37);
		expect(new Set(ids).size).toBe(ids.length);
	});
});
