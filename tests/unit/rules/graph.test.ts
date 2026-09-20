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
import { runProjectRules } from "../../../src/engine/project-rules.js";
import type { ProjectRuleDefinition } from "../../../src/engine/registry.js";
import { circularDependency } from "../../../src/rules/graph/circular-dependency.js";

const REPO_ROOT = path.resolve(import.meta.dirname, "../../..");
const GRAPH_ROOT = path.resolve(import.meta.dirname, "../../fixtures/graph");

/**
 * Runs one project rule over a multi-file fixture tree (spec 013 design
 * §9): the graph needs the whole tree, so the fixture shape follows the
 * analysis (the `nest/` precedent).
 */
function scanGraphFixture(
	rule: ProjectRuleDefinition,
	fixtureName: string,
): Diagnostic[] {
	const target = path.join(GRAPH_ROOT, fixtureName);
	const paths = collectFiles({
		target,
		extensions: SUPPORTED_EXTENSIONS,
		excludes: [],
		ignoreGlobs: [],
	});
	const adapter = new TsMorphParserAdapter();
	const { files } = adapter.createProject(paths);
	return runProjectRules({
		files,
		rules: [rule],
		config: defaultConfig(),
		adapter,
		scanRoot: target,
		detectedFrameworks: [],
		packageRoot: target,
	}).diagnostics;
}

function summarize(diagnostics: Diagnostic[]) {
	return diagnostics.map((d) => ({
		file: path.relative(GRAPH_ROOT, d.filePath),
		line: d.line,
		column: d.column,
		message: d.message,
		severity: d.severity,
		category: d.category,
	}));
}

function circularMessage(chain: string): string {
	return `${chain} form an import cycle; circular imports hide initialization order and break tree-shaking. Break the cycle by moving the shared code into a module both sides can import.`;
}

describe("backend-doctor/circular-dependency (AC-1, AC-9)", () => {
	it("flags every file of an import cycle at its first participating import (AC-1)", () => {
		expect(
			summarize(
				scanGraphFixture(circularDependency, "circular-dependency/invalid"),
			),
		).toEqual([
			{
				file: path.join("circular-dependency", "invalid", "a.ts"),
				line: 1,
				column: 1,
				message: circularMessage("a.ts -> b.ts -> c.ts -> a.ts"),
				severity: "warn",
				category: "Architecture",
			},
			{
				file: path.join("circular-dependency", "invalid", "b.ts"),
				line: 1,
				column: 1,
				message: circularMessage("a.ts -> b.ts -> c.ts -> a.ts"),
				severity: "warn",
				category: "Architecture",
			},
			{
				file: path.join("circular-dependency", "invalid", "c.ts"),
				line: 1,
				column: 1,
				message: circularMessage("a.ts -> b.ts -> c.ts -> a.ts"),
				severity: "warn",
				category: "Architecture",
			},
		]);
	});

	it("stays silent on acyclic chains, self-imports and package imports (AC-1)", () => {
		expect(
			scanGraphFixture(circularDependency, "circular-dependency/valid"),
		).toEqual([]);
	});

	it("ships valid/invalid fixture trees and a rule doc (AC-9)", () => {
		for (const dir of ["valid", "invalid"]) {
			expect(
				fs.existsSync(path.join(GRAPH_ROOT, "circular-dependency", dir)),
				dir,
			).toBe(true);
		}
		expect(
			fs.existsSync(path.join(REPO_ROOT, circularDependency.docs)),
			circularDependency.docs,
		).toBe(true);
	});
});
