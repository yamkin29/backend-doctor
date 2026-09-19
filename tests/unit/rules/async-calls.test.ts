import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { TsMorphParserAdapter } from "../../../src/engine/parser/ts-morph-adapter.js";
import { findStatementLevelAsyncCalls } from "../../../src/rules/async/async-calls.js";

/**
 * Runs the shared async-call heuristic over a synthetic file and returns
 * compact candidate summaries: the call text and whether the call sits
 * directly in a constructor body.
 */
function analyze(
	source: string,
): Array<{ text: string; inConstructor: boolean }> {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "backend-doctor-async-"));
	const filePath = path.join(dir, "sample.ts");
	fs.writeFileSync(filePath, source);
	try {
		const adapter = new TsMorphParserAdapter();
		const { files } = adapter.createProject([filePath]);
		const view = files[0];
		if (!view) throw new Error("sample file did not parse");
		return findStatementLevelAsyncCalls(view).map((candidate) => ({
			text: candidate.call.getText(),
			inConstructor: candidate.inConstructor,
		}));
	} finally {
		fs.rmSync(dir, { recursive: true, force: true });
	}
}

describe("findStatementLevelAsyncCalls — candidate forms", () => {
	it("flags a statement-level call to a same-file async function declaration", () => {
		expect(
			analyze("async function load(): Promise<void> {}\nload();\n"),
		).toEqual([{ text: "load()", inConstructor: false }]);
	});

	it("flags a statement-level call to an async arrow assigned to a variable", () => {
		expect(
			analyze("const load = async (): Promise<void> => {};\nload();\n"),
		).toEqual([{ text: "load()", inConstructor: false }]);
	});

	it("flags a statement-level call to an async function expression variable", () => {
		expect(
			analyze(
				"const load = async function load(): Promise<void> {};\nload();\n",
			),
		).toEqual([{ text: "load()", inConstructor: false }]);
	});

	it("flags this.<asyncMethod>() inside the declaring class", () => {
		expect(
			analyze(
				[
					"class Users {",
					"\tasync load(): Promise<void> {}",
					"\trefresh(): void {",
					"\t\tthis.load();",
					"\t}",
					"}",
				].join("\n"),
			),
		).toEqual([{ text: "this.load()", inConstructor: false }]);
	});

	it("flags an async class property called via this", () => {
		expect(
			analyze(
				[
					"class Users {",
					"\tprivate load = async (): Promise<void> => {};",
					"\trefresh(): void {",
					"\t\tthis.load();",
					"\t}",
					"}",
				].join("\n"),
			),
		).toEqual([{ text: "this.load()", inConstructor: false }]);
	});

	it("flags a bare fetch call", () => {
		expect(analyze('fetch("https://example.com");\n')).toEqual([
			{ text: 'fetch("https://example.com")', inConstructor: false },
		]);
	});
});

describe("findStatementLevelAsyncCalls — scope-aware resolution", () => {
	it("does not flag a call whose name has no same-file async binding", () => {
		expect(analyze("function save(): void {}\nsave();\n")).toEqual([]);
	});

	it("prefers the nearest binding: inner sync shadows outer async", () => {
		expect(
			analyze(
				[
					"async function load(): Promise<void> {}",
					"function wrapper(): void {",
					"\tfunction load(): void {}",
					"\tload();",
					"}",
					"load();",
				].join("\n"),
			),
		).toEqual([{ text: "load()", inConstructor: false }]);
	});

	it("prefers the nearest binding: inner async shadows outer sync", () => {
		expect(
			analyze(
				[
					"function load(): void {}",
					"function wrapper(): void {",
					"\tasync function load(): Promise<void> {}",
					"\tload();",
					"}",
				].join("\n"),
			),
		).toEqual([{ text: "load()", inConstructor: false }]);
	});

	it("does not flag this.<name>() against a method of a different class", () => {
		expect(
			analyze(
				[
					"class A {",
					"\tasync load(): Promise<void> {}",
					"}",
					"class B {",
					"\trefresh(): void {",
					"\t\tthis.load();",
					"\t}",
					"}",
				].join("\n"),
			),
		).toEqual([]);
	});

	it("treats a same-file binding of fetch as a shadow", () => {
		expect(
			analyze("const fetch = (url: string): number => 1;\nfetch('x');\n"),
		).toEqual([]);
	});

	it("does not flag class method declarations as identifier bindings", () => {
		expect(
			analyze(
				[
					"class Users {",
					"\tasync load(): Promise<void> {}",
					"\trefresh(): void {",
					"\t\tload();",
					"\t}",
					"}",
				].join("\n"),
			),
		).toEqual([]);
	});
});

describe("findStatementLevelAsyncCalls — suppressed forms (AC-4)", () => {
	const cases: Array<[string, string]> = [
		[
			"awaited",
			"async function load(): Promise<void> {}\nasync function main(): Promise<void> { await load(); }",
		],
		["void-prefixed", "async function load(): Promise<void> {}\nvoid load();"],
		["assigned", "async function load(): Promise<void> {}\nconst p = load();"],
		[
			"returned",
			"async function load(): Promise<void> {}\nfunction main() { return load(); }",
		],
		[
			"then-chained",
			"async function load(): Promise<void> {}\nload().then(() => {});",
		],
		[
			"catch-chained",
			"async function load(): Promise<void> {}\nload().catch(() => {});",
		],
	];

	for (const [name, source] of cases) {
		it(`does not flag the ${name} form`, () => {
			expect(analyze(source)).toEqual([]);
		});
	}
});

describe("findStatementLevelAsyncCalls — constructor tagging (AC-6, AC-11)", () => {
	it("tags statement-level async calls directly inside constructors", () => {
		expect(
			analyze(
				[
					"async function bootstrap(): Promise<void> {}",
					"class App {",
					"\tconstructor() {",
					"\t\tbootstrap();",
					"\t}",
					"}",
				].join("\n"),
			),
		).toEqual([{ text: "bootstrap()", inConstructor: true }]);
	});

	it("tags this.<asyncMethod>() inside the constructor", () => {
		expect(
			analyze(
				[
					"class App {",
					"\tasync start(): Promise<void> {}",
					"\tconstructor() {",
					"\t\tthis.start();",
					"\t}",
					"}",
				].join("\n"),
			),
		).toEqual([{ text: "this.start()", inConstructor: true }]);
	});

	it("tags fetch inside a constructor", () => {
		expect(
			analyze(
				[
					"class App {",
					"\tconstructor() {",
					'\t\tfetch("https://example.com");',
					"\t}",
					"}",
				].join("\n"),
			),
		).toEqual([{ text: 'fetch("https://example.com")', inConstructor: true }]);
	});

	it("does not tag async calls nested in functions declared inside constructors", () => {
		expect(
			analyze(
				[
					"async function bootstrap(): Promise<void> {}",
					"class App {",
					"\tconstructor() {",
					"\t\tfunction helper(): void {",
					"\t\t\tbootstrap();",
					"\t\t}",
					"\t\thelper();",
					"\t}",
					"}",
				].join("\n"),
			),
		).toEqual([{ text: "bootstrap()", inConstructor: false }]);
	});
});
