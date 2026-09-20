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
import { noBusinessLogicInController } from "../../../src/rules/nest/no-business-logic-in-controller.js";

const REPO_ROOT = path.resolve(import.meta.dirname, "../../..");
const FIXTURE_ROOT = path.resolve(
	import.meta.dirname,
	"../../fixtures/nest/layers-dto",
);

/** Runs one rule over a multi-file fixture app with the real extractor. */
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

function expectFixturesAndDoc(rule: RuleDefinition, fixtureName: string): void {
	for (const dir of ["valid", "invalid"]) {
		expect(fs.existsSync(path.join(FIXTURE_ROOT, fixtureName, dir)), dir).toBe(
			true,
		);
	}
	expect(fs.existsSync(path.join(REPO_ROOT, rule.docs)), rule.docs).toBe(true);
}

describe("backend-doctor/no-business-logic-in-controller (AC-4, AC-14)", () => {
	it("flags handlers with two or more branch points (AC-4)", () => {
		expect(
			summarize(
				scanNestFixture(
					noBusinessLogicInController,
					"controller-logic/invalid",
				),
			),
		).toEqual([
			{
				file: path.join("controller-logic", "invalid", "orders.controller.ts"),
				line: 5,
				column: 2,
				message:
					"create in OrdersController carries 2 branch points; this reads as business logic living in the controller. Move the branching into a service and keep the handler a thin delegation.",
				severity: "warn",
				category: "Architecture",
			},
			{
				file: path.join("controller-logic", "invalid", "orders.controller.ts"),
				line: 17,
				column: 2,
				message:
					"list in OrdersController carries 2 branch points; this reads as business logic living in the controller. Move the branching into a service and keep the handler a thin delegation.",
				severity: "warn",
				category: "Architecture",
			},
		]);
	});

	it("stays silent on guard clauses, delegation and non-verb methods (AC-4)", () => {
		expect(
			scanNestFixture(noBusinessLogicInController, "controller-logic/valid"),
		).toEqual([]);
	});

	it("ships valid/invalid fixtures and a rule doc (AC-14)", () => {
		expectFixturesAndDoc(noBusinessLogicInController, "controller-logic");
	});
});
