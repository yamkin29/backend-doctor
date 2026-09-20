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
import { circularDi } from "../../../src/rules/nest/circular-di.js";
import { missingForwardRef } from "../../../src/rules/nest/missing-forward-ref.js";
import { providerNotRegistered } from "../../../src/rules/nest/provider-not-registered.js";

const REPO_ROOT = path.resolve(import.meta.dirname, "../../..");
const FIXTURE_ROOT = path.resolve(
	import.meta.dirname,
	"../../fixtures/nest/di-rules",
);

/** Runs one DI rule over a multi-file fixture app with the real extractor. */
function scanNestFixture(
	rule: RuleDefinition,
	fixtureName: string,
): Diagnostic[] {
	const target = path.join(FIXTURE_ROOT, fixtureName);
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

describe("backend-doctor/provider-not-registered (AC-6, AC-7, AC-14)", () => {
	const message =
		"OrphanService is injected here but none of the modules registering TasksController provide or export it (directly or via imports); Nest fails to resolve this dependency at bootstrap. Add OrphanService to a providers array or import a module that provides it.";

	it("flags an injection no owning module provides (AC-6)", () => {
		expect(
			summarize(
				scanNestFixture(
					providerNotRegistered,
					"provider-not-registered/invalid",
				),
			),
		).toEqual([
			{
				file: path.join(
					"provider-not-registered",
					"invalid",
					"tasks.controller.ts",
				),
				line: 9,
				column: 3,
				message,
				severity: "warn",
				category: "Correctness",
			},
		]);
	});

	it("stays silent when the provider is reachable, global or unknown (AC-7)", () => {
		expect(
			scanNestFixture(providerNotRegistered, "provider-not-registered/valid"),
		).toEqual([]);
	});

	it("ships valid/invalid fixtures and a rule doc (AC-14)", () => {
		for (const dir of ["valid", "invalid"]) {
			expect(
				fs.existsSync(path.join(FIXTURE_ROOT, "provider-not-registered", dir)),
				dir,
			).toBe(true);
		}
		expect(
			fs.existsSync(
				path.join(
					REPO_ROOT,
					"docs/rules/backend-doctor/provider-not-registered.md",
				),
			),
		).toBe(true);
	});
});

describe("backend-doctor/circular-di (AC-8, AC-14)", () => {
	const rule = circularDi;
	const message = (pathText: string) =>
		`Providers form a circular dependency: ${pathText}. Restructure so dependencies flow one way (extract a shared third provider); a truly mutual pair needs forwardRef() on both sides.`;

	it("reports one diagnostic per cycle at the canonical member (AC-8)", () => {
		expect(summarize(scanNestFixture(rule, "circular-di/invalid"))).toEqual([
			{
				file: path.join("circular-di", "invalid", "a.service.ts"),
				line: 3,
				column: 1,
				message: message("AService → BService → AService"),
				severity: "warn",
				category: "Architecture",
			},
			{
				file: path.join("circular-di", "invalid", "c.service.ts"),
				line: 3,
				column: 1,
				message: message("CService → DService → EService → CService"),
				severity: "warn",
				category: "Architecture",
			},
			{
				file: path.join("circular-di", "invalid", "loop.service.ts"),
				line: 3,
				column: 1,
				message: message("LoopService → LoopService"),
				severity: "warn",
				category: "Architecture",
			},
		]);
	});

	it("stays silent on an acyclic provider graph (AC-8)", () => {
		expect(scanNestFixture(rule, "circular-di/valid")).toEqual([]);
	});

	it("ships valid/invalid fixtures and a rule doc (AC-14)", () => {
		for (const dir of ["valid", "invalid"]) {
			expect(
				fs.existsSync(path.join(FIXTURE_ROOT, "circular-di", dir)),
				dir,
			).toBe(true);
		}
		expect(
			fs.existsSync(
				path.join(REPO_ROOT, "docs/rules/backend-doctor/circular-di.md"),
			),
		).toBe(true);
	});
});

describe("backend-doctor/missing-forward-ref (AC-9, AC-14)", () => {
	const rule = missingForwardRef;
	const message = (pathText: string) =>
		`The injection cycle ${pathText} uses no forwardRef(), so Nest cannot construct these providers and fails at bootstrap with a circular-dependency error. Wrap the type in forwardRef(() => X) on both sides or restructure.`;

	it("reports the closing edge of a forwardRef-less cycle (AC-9)", () => {
		expect(
			summarize(scanNestFixture(rule, "missing-forward-ref/invalid")),
		).toEqual([
			{
				file: path.join("missing-forward-ref", "invalid", "y.service.ts"),
				line: 5,
				column: 14,
				message: message("XService → YService → XService"),
				severity: "warn",
				category: "Correctness",
			},
		]);
	});

	it("stays silent when the cycle already uses forwardRef (AC-9)", () => {
		expect(scanNestFixture(rule, "missing-forward-ref/valid")).toEqual([]);
	});

	it("ships valid/invalid fixtures and a rule doc (AC-14)", () => {
		for (const dir of ["valid", "invalid"]) {
			expect(
				fs.existsSync(path.join(FIXTURE_ROOT, "missing-forward-ref", dir)),
				dir,
			).toBe(true);
		}
		expect(
			fs.existsSync(
				path.join(
					REPO_ROOT,
					"docs/rules/backend-doctor/missing-forward-ref.md",
				),
			),
		).toBe(true);
	});
});
