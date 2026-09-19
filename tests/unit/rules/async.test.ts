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
import { noAsyncConstructorWork } from "../../../src/rules/async/no-async-constructor-work.js";
import { noAsyncForeachCallback } from "../../../src/rules/async/no-async-foreach-callback.js";
import { noFloatingPromises } from "../../../src/rules/async/no-floating-promises.js";
import { unhandledJsonParse } from "../../../src/rules/async/unhandled-json-parse.js";

const FIXTURE_ROOT = path.resolve(
	import.meta.dirname,
	"../../fixtures/backend-doctor",
);

/** Short fixture id → rule under test (grows with each rule task). */
const rules: Record<string, RuleDefinition> = {
	"no-floating-promises": noFloatingPromises,
	"no-async-constructor-work": noAsyncConstructorWork,
	"no-async-foreach-callback": noAsyncForeachCallback,
	"unhandled-json-parse": unhandledJsonParse,
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

describe("backend-doctor/no-floating-promises (AC-1..6)", () => {
	const message =
		"This call returns a promise that is neither awaited nor handled; its rejection is silently lost. Add await, a .catch handler, or the void operator if fire-and-forget is intended.";

	it("flags async calls with exact diagnostics (AC-1..3, AC-5)", () => {
		expect(
			summarize(
				scanFixture("no-floating-promises", "no-floating-promises/invalid"),
			),
		).toEqual([
			{
				file: path.join("no-floating-promises", "invalid", "async-arrow.ts"),
				line: 2,
				column: 1,
				message,
				severity: "warn",
				category: "Correctness",
			},
			{
				file: path.join("no-floating-promises", "invalid", "async-fn.ts"),
				line: 2,
				column: 1,
				message,
				severity: "warn",
				category: "Correctness",
			},
			{
				file: path.join("no-floating-promises", "invalid", "fetch.ts"),
				line: 2,
				column: 2,
				message,
				severity: "warn",
				category: "Correctness",
			},
			{
				file: path.join("no-floating-promises", "invalid", "shadowed-local.ts"),
				line: 6,
				column: 1,
				message,
				severity: "warn",
				category: "Correctness",
			},
			{
				file: path.join("no-floating-promises", "invalid", "this-method.ts"),
				line: 4,
				column: 3,
				message,
				severity: "warn",
				category: "Correctness",
			},
		]);
	});

	it("stays silent on false-positive-prone valid fixtures (AC-4..6)", () => {
		expect(
			scanFixture("no-floating-promises", "no-floating-promises/valid"),
		).toEqual([]);
	});
});

describe("backend-doctor/no-async-constructor-work (AC-11..12)", () => {
	const message =
		"Constructor starts async work without awaiting it; initialization races with first use. Move the work into an explicit init method that callers can await.";

	it("flags async work started in constructors with exact diagnostics (AC-11)", () => {
		expect(
			summarize(
				scanFixture(
					"no-async-constructor-work",
					"no-async-constructor-work/invalid",
				),
			),
		).toEqual([
			{
				file: path.join("no-async-constructor-work", "invalid", "fetch.ts"),
				line: 3,
				column: 3,
				message,
				severity: "warn",
				category: "Correctness",
			},
			{
				file: path.join("no-async-constructor-work", "invalid", "helper-fn.ts"),
				line: 4,
				column: 3,
				message,
				severity: "warn",
				category: "Correctness",
			},
			{
				file: path.join(
					"no-async-constructor-work",
					"invalid",
					"this-method.ts",
				),
				line: 7,
				column: 3,
				message,
				severity: "warn",
				category: "Correctness",
			},
		]);
	});

	it("stays silent on void-prefixed and synchronous constructors (AC-12)", () => {
		expect(
			scanFixture(
				"no-async-constructor-work",
				"no-async-constructor-work/valid",
			),
		).toEqual([]);
	});
});

describe("backend-doctor/no-async-foreach-callback (AC-7..8)", () => {
	const message =
		"Array.forEach does not await async callbacks, so iteration order is lost and rejections go unhandled. Use for…of with await or Promise.all(items.map(...)).";

	it("flags forEach with an inline async callback (AC-7)", () => {
		expect(
			summarize(
				scanFixture(
					"no-async-foreach-callback",
					"no-async-foreach-callback/invalid",
				),
			),
		).toEqual([
			{
				file: path.join(
					"no-async-foreach-callback",
					"invalid",
					"async-arrow.ts",
				),
				line: 5,
				column: 1,
				message,
				severity: "warn",
				category: "Bugs",
			},
			{
				file: path.join(
					"no-async-foreach-callback",
					"invalid",
					"async-function.ts",
				),
				line: 2,
				column: 1,
				message,
				severity: "warn",
				category: "Bugs",
			},
		]);
	});

	it("stays silent on sync callbacks, map+Promise.all and for-of-await (AC-8)", () => {
		expect(
			scanFixture(
				"no-async-foreach-callback",
				"no-async-foreach-callback/valid",
			),
		).toEqual([]);
	});
});

describe("backend-doctor/unhandled-json-parse (AC-9..10)", () => {
	const message =
		"JSON.parse throws on malformed input and this call is not guarded by try/catch; a bad payload will crash this code path. Guard it or validate the input first.";

	it("flags unguarded JSON.parse inside function bodies (AC-9)", () => {
		expect(
			summarize(
				scanFixture("unhandled-json-parse", "unhandled-json-parse/invalid"),
			),
		).toEqual([
			{
				file: path.join("unhandled-json-parse", "invalid", "finally-only.ts"),
				line: 3,
				column: 10,
				message,
				severity: "warn",
				category: "Bugs",
			},
			{
				file: path.join("unhandled-json-parse", "invalid", "in-function.ts"),
				line: 2,
				column: 9,
				message,
				severity: "warn",
				category: "Bugs",
			},
		]);
	});

	it("stays silent inside try/catch and at module top level (AC-10)", () => {
		expect(
			scanFixture("unhandled-json-parse", "unhandled-json-parse/valid"),
		).toEqual([]);
	});
});
