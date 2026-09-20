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
import { noPrismaNPlusOne } from "../../../src/rules/prisma/no-prisma-n-plus-one.js";
import { noUnsafeRawQuery } from "../../../src/rules/prisma/no-unsafe-raw-query.js";

const REPO_ROOT = path.resolve(import.meta.dirname, "../../..");
const FLAT_ROOT = path.resolve(
	import.meta.dirname,
	"../../fixtures/backend-doctor",
);

/** Short fixture id → rule under test (grows with each rule task). */
const rulesById: Record<string, RuleDefinition> = {
	"no-prisma-n-plus-one": noPrismaNPlusOne,
	"no-unsafe-raw-query": noUnsafeRawQuery,
};

/**
 * Runs one prisma-gated rule over a flat fixture directory. The pack gate
 * is on: the flat convention needs no model, only the detected framework
 * (spec 012 design decision 9).
 */
function scanFixture(
	shortId: string,
	fixtureName: string,
	detectedFrameworks: readonly string[] = ["prisma"],
): Diagnostic[] {
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
				detectedFrameworks,
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

const N_PLUS_ONE_MESSAGE =
	"This Prisma query runs once per loop iteration (N+1): every pass makes another database round-trip. Fetch everything in one query instead — load relations with include/select, or batch the ids with findMany({ where: { id: { in: ids } } }).";

describe("backend-doctor/no-prisma-n-plus-one (AC-1, AC-5, AC-9)", () => {
	it("flags awaited read queries inside loop bodies with exact diagnostics (AC-1)", () => {
		expect(
			summarize(
				scanFixture("no-prisma-n-plus-one", "no-prisma-n-plus-one/invalid"),
			),
		).toEqual([
			{
				file: path.join("no-prisma-n-plus-one", "invalid", "for-await.ts"),
				line: 7,
				column: 22,
				message: N_PLUS_ONE_MESSAGE,
				severity: "warn",
				category: "Performance",
			},
			{
				file: path.join("no-prisma-n-plus-one", "invalid", "for-of-await.ts"),
				line: 9,
				column: 23,
				message: N_PLUS_ONE_MESSAGE,
				severity: "warn",
				category: "Performance",
			},
			{
				file: path.join("no-prisma-n-plus-one", "invalid", "while-await.ts"),
				line: 9,
				column: 18,
				message: N_PLUS_ONE_MESSAGE,
				severity: "warn",
				category: "Performance",
			},
		]);
	});

	it("stays silent on batched reads, nested functions, pre-loop awaits, floating calls and own members (AC-1, AC-5)", () => {
		expect(
			scanFixture("no-prisma-n-plus-one", "no-prisma-n-plus-one/valid"),
		).toEqual([]);
	});

	it("produces nothing when prisma is not detected (AC-6)", () => {
		expect(
			scanFixture("no-prisma-n-plus-one", "no-prisma-n-plus-one/invalid", []),
		).toEqual([]);
	});

	it("ships valid/invalid fixtures and a rule doc (AC-9)", () => {
		for (const dir of ["valid", "invalid"]) {
			expect(
				fs.existsSync(path.join(FLAT_ROOT, "no-prisma-n-plus-one", dir)),
				dir,
			).toBe(true);
		}
		expect(
			fs.existsSync(path.join(REPO_ROOT, noPrismaNPlusOne.docs)),
			noPrismaNPlusOne.docs,
		).toBe(true);
	});
});

const RAW_QUERY_MESSAGE =
	"Raw query text is built dynamically here: interpolated input allows SQL injection. Use the tagged-template form prisma.$queryRaw`…` so values become parameters, or compose fragments with Prisma.sql / Prisma.join.";

describe("backend-doctor/no-unsafe-raw-query (AC-2, AC-5, AC-9)", () => {
	it("flags dynamic raw-query text with exact diagnostics (AC-2)", () => {
		expect(
			summarize(
				scanFixture("no-unsafe-raw-query", "no-unsafe-raw-query/invalid"),
			),
		).toEqual([
			{
				file: path.join("no-unsafe-raw-query", "invalid", "concat-unsafe.ts"),
				line: 6,
				column: 9,
				message: RAW_QUERY_MESSAGE,
				severity: "warn",
				category: "Security",
			},
			{
				file: path.join(
					"no-unsafe-raw-query",
					"invalid",
					"plain-call-dynamic.ts",
				),
				line: 6,
				column: 9,
				message: RAW_QUERY_MESSAGE,
				severity: "warn",
				category: "Security",
			},
			{
				file: path.join("no-unsafe-raw-query", "invalid", "template-unsafe.ts"),
				line: 6,
				column: 9,
				message: RAW_QUERY_MESSAGE,
				severity: "warn",
				category: "Security",
			},
		]);
	});

	it("stays silent on tagged templates, literals, Prisma.sql and span-free templates (AC-2, AC-5)", () => {
		expect(
			scanFixture("no-unsafe-raw-query", "no-unsafe-raw-query/valid"),
		).toEqual([]);
	});

	it("produces nothing when prisma is not detected (AC-6)", () => {
		expect(
			scanFixture("no-unsafe-raw-query", "no-unsafe-raw-query/invalid", []),
		).toEqual([]);
	});

	it("ships valid/invalid fixtures and a rule doc (AC-9)", () => {
		for (const dir of ["valid", "invalid"]) {
			expect(
				fs.existsSync(path.join(FLAT_ROOT, "no-unsafe-raw-query", dir)),
				dir,
			).toBe(true);
		}
		expect(
			fs.existsSync(path.join(REPO_ROOT, noUnsafeRawQuery.docs)),
			noUnsafeRawQuery.docs,
		).toBe(true);
	});
});
