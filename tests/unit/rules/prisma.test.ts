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
import { findManyWithoutPagination } from "../../../src/rules/prisma/find-many-without-pagination.js";
import { noLongRunningTransaction } from "../../../src/rules/prisma/no-long-running-transaction.js";
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
	"find-many-without-pagination": findManyWithoutPagination,
	"no-long-running-transaction": noLongRunningTransaction,
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

const PAGINATION_MESSAGE =
	"findMany without take loads every matching row into memory; bound the result set with take (and skip or cursor for paging).";

describe("backend-doctor/find-many-without-pagination (AC-3, AC-5, AC-9)", () => {
	it("flags unbounded findMany calls with exact diagnostics (AC-3)", () => {
		expect(
			summarize(
				scanFixture(
					"find-many-without-pagination",
					"find-many-without-pagination/invalid",
				),
			),
		).toEqual([
			{
				file: path.join(
					"find-many-without-pagination",
					"invalid",
					"no-args.ts",
				),
				line: 6,
				column: 9,
				message: PAGINATION_MESSAGE,
				severity: "warn",
				category: "Performance",
			},
			{
				file: path.join(
					"find-many-without-pagination",
					"invalid",
					"no-take.ts",
				),
				line: 6,
				column: 9,
				message: PAGINATION_MESSAGE,
				severity: "warn",
				category: "Performance",
			},
		]);
	});

	it("stays silent on take, spread or variable arguments and other query methods (AC-3, AC-5)", () => {
		expect(
			scanFixture(
				"find-many-without-pagination",
				"find-many-without-pagination/valid",
			),
		).toEqual([]);
	});

	it("produces nothing when prisma is not detected (AC-6)", () => {
		expect(
			scanFixture(
				"find-many-without-pagination",
				"find-many-without-pagination/invalid",
				[],
			),
		).toEqual([]);
	});

	it("ships valid/invalid fixtures and a rule doc (AC-9)", () => {
		for (const dir of ["valid", "invalid"]) {
			expect(
				fs.existsSync(
					path.join(FLAT_ROOT, "find-many-without-pagination", dir),
				),
				dir,
			).toBe(true);
		}
		expect(
			fs.existsSync(path.join(REPO_ROOT, findManyWithoutPagination.docs)),
			findManyWithoutPagination.docs,
		).toBe(true);
	});
});

function transactionMessage(name: string): string {
	return `${name} runs inside an interactive $transaction: the transaction holds its locks while waiting on external I/O. Move external calls and delays outside the transaction and keep only Prisma statements inside.`;
}

describe("backend-doctor/no-long-running-transaction (AC-4, AC-5, AC-9)", () => {
	it("flags external I/O and timers inside interactive transactions with exact diagnostics (AC-4)", () => {
		expect(
			summarize(
				scanFixture(
					"no-long-running-transaction",
					"no-long-running-transaction/invalid",
				),
			),
		).toEqual([
			{
				file: path.join(
					"no-long-running-transaction",
					"invalid",
					"axios-inside.ts",
				),
				line: 9,
				column: 25,
				message: transactionMessage("axios.get"),
				severity: "warn",
				category: "Performance",
			},
			{
				file: path.join(
					"no-long-running-transaction",
					"invalid",
					"fetch-inside.ts",
				),
				line: 9,
				column: 25,
				message: transactionMessage("fetch"),
				severity: "warn",
				category: "Performance",
			},
			{
				file: path.join(
					"no-long-running-transaction",
					"invalid",
					"timer-inside.ts",
				),
				line: 8,
				column: 34,
				message: transactionMessage("setTimeout"),
				severity: "warn",
				category: "Performance",
			},
		]);
	});

	it("stays silent on DB-only callbacks, external calls outside the callback and the array form (AC-4, AC-5)", () => {
		expect(
			scanFixture(
				"no-long-running-transaction",
				"no-long-running-transaction/valid",
			),
		).toEqual([]);
	});

	it("produces nothing when prisma is not detected (AC-6)", () => {
		expect(
			scanFixture(
				"no-long-running-transaction",
				"no-long-running-transaction/invalid",
				[],
			),
		).toEqual([]);
	});

	it("ships valid/invalid fixtures and a rule doc (AC-9)", () => {
		for (const dir of ["valid", "invalid"]) {
			expect(
				fs.existsSync(path.join(FLAT_ROOT, "no-long-running-transaction", dir)),
				dir,
			).toBe(true);
		}
		expect(
			fs.existsSync(path.join(REPO_ROOT, noLongRunningTransaction.docs)),
			noLongRunningTransaction.docs,
		).toBe(true);
	});
});
