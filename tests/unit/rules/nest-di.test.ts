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
