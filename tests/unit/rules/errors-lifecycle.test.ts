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
import { extractNestAppModel } from "../../../src/framework/nest/extract.js";
import { noEmptyCatch } from "../../../src/rules/errors/no-empty-catch.js";
import { noErrorDetailsLeak } from "../../../src/rules/errors/no-error-details-leak.js";
import { missingOnModuleDestroy } from "../../../src/rules/nest/missing-on-module-destroy.js";

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
	"no-error-details-leak": noErrorDetailsLeak,
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

/** Runs one nest-gated rule over a fixture mini-app with the real extractor. */
function scanNestFixture(
	rule: RuleDefinition,
	fixtureName: string,
): Diagnostic[] {
	const target = path.join(NEST_ROOT, fixtureName);
	const paths = collectFiles({
		target,
		extensions: SUPPORTED_EXTENSIONS,
		excludes: [],
		ignoreGlobs: [],
	});
	const adapter = new TsMorphParserAdapter();
	const { files: views } = adapter.createProject(paths);
	const nestModel = extractNestAppModel(views, adapter);

	const diagnostics: Diagnostic[] = [];
	for (const view of views) {
		diagnostics.push(
			...runRules({
				file: view,
				rules: [rule],
				config: defaultConfig(),
				adapter,
				scanRoot: target,
				detectedFrameworks: ["nest"],
				nestModel,
			}).diagnostics,
		);
	}
	return diagnostics;
}

function summarizeNest(diagnostics: Diagnostic[]) {
	return diagnostics.map((d) => ({
		file: path.relative(NEST_ROOT, d.filePath),
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

const LEAK_MESSAGE =
	"A stack trace reaches the client through this response; stacks expose file paths and internal structure. Log the error server-side and return a generic message or a safe error payload instead.";

describe("backend-doctor/no-error-details-leak (AC-2, AC-5, AC-9)", () => {
	it("flags stack traces in response calls with exact diagnostics (AC-2)", () => {
		expect(
			summarize(
				scanFixture("no-error-details-leak", "no-error-details-leak/invalid"),
			),
		).toEqual([
			{
				file: path.join("no-error-details-leak", "invalid", "express-style.ts"),
				line: 8,
				column: 2,
				message: LEAK_MESSAGE,
				severity: "warn",
				category: "Security",
			},
			{
				file: path.join("no-error-details-leak", "invalid", "nest-filter.ts"),
				line: 12,
				column: 3,
				message: LEAK_MESSAGE,
				severity: "warn",
				category: "Security",
			},
		]);
	});

	it("flags one diagnostic per response call however many stack references it carries (AC-2)", () => {
		const diagnostics = scanFixture(
			"no-error-details-leak",
			"no-error-details-leak/invalid",
		).filter((d) => d.filePath.endsWith("nest-filter.ts"));
		expect(diagnostics).toHaveLength(1);
	});

	it("stays silent on message-only responses, non-response receivers and stack-free responses (AC-2, AC-5)", () => {
		expect(
			scanFixture("no-error-details-leak", "no-error-details-leak/valid"),
		).toEqual([]);
	});

	it("ships valid/invalid fixtures and a rule doc (AC-9)", () => {
		for (const dir of ["valid", "invalid"]) {
			expect(
				fs.existsSync(path.join(FLAT_ROOT, "no-error-details-leak", dir)),
				dir,
			).toBe(true);
		}
		expect(
			fs.existsSync(path.join(REPO_ROOT, noErrorDetailsLeak.docs)),
			noErrorDetailsLeak.docs,
		).toBe(true);
	});
});

function missingDestroyMessage(className: string, hook: string): string {
	return `${className} initializes in ${hook} but declares no shutdown hook; resources acquired there are never released. Add onModuleDestroy (or beforeApplicationShutdown / onApplicationShutdown) to release them.`;
}

describe("backend-doctor/missing-on-module-destroy (AC-3, AC-5, AC-9)", () => {
	it("flags providers that initialize without a shutdown hook (AC-3)", () => {
		expect(
			summarizeNest(
				scanNestFixture(missingOnModuleDestroy, "lifecycle-hooks/invalid"),
			),
		).toEqual([
			{
				file: path.join("lifecycle-hooks", "invalid", "boot.service.ts"),
				line: 3,
				column: 1,
				message: missingDestroyMessage("BootService", "onApplicationBootstrap"),
				severity: "warn",
				category: "Correctness",
			},
			{
				file: path.join("lifecycle-hooks", "invalid", "timer.service.ts"),
				line: 3,
				column: 1,
				message: missingDestroyMessage("TimerService", "onModuleInit"),
				severity: "warn",
				category: "Correctness",
			},
		]);
	});

	it("stays silent on cleanup hooks, init-free providers and controllers (AC-3, AC-5)", () => {
		expect(
			scanNestFixture(missingOnModuleDestroy, "lifecycle-hooks/valid"),
		).toEqual([]);
	});

	it("ships valid/invalid fixtures and a rule doc (AC-9)", () => {
		for (const dir of ["valid", "invalid"]) {
			expect(
				fs.existsSync(path.join(NEST_ROOT, "lifecycle-hooks", dir)),
				dir,
			).toBe(true);
		}
		expect(
			fs.existsSync(path.join(REPO_ROOT, missingOnModuleDestroy.docs)),
			missingOnModuleDestroy.docs,
		).toBe(true);
	});
});
