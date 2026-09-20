import { describe, expect, it } from "vitest";
import { parseHunks } from "../../../src/scope/diff.js";

describe("parseHunks", () => {
	it("maps a canonical hunk header to an inclusive new-side range", () => {
		const diff = ["@@ -1,3 +1,4 @@", " context", "+added"].join("\n");
		expect(parseHunks(diff)).toEqual([{ start: 1, end: 4 }]);
	});

	it("treats a count-less new side as a single line", () => {
		expect(parseHunks("@@ -5 +5 @@\n-x\n+x")).toEqual([{ start: 5, end: 5 }]);
	});

	it("maps a new-file hunk (-0,0 +1,N) to lines 1..N", () => {
		expect(parseHunks("@@ -0,0 +1,3 @@\n+a\n+b\n+c")).toEqual([
			{ start: 1, end: 3 },
		]);
	});

	it("contributes nothing for a deletion-only hunk (new-side count 0)", () => {
		expect(parseHunks("@@ -3,2 +2,0 @@\n-gone\n-gone too")).toEqual([]);
	});

	it("ignores \\ No newline markers and diff content", () => {
		const diff = [
			"@@ -1 +1 @@",
			"-old",
			"\\ No newline at end of file",
			"+new",
			"\\ No newline at end of file",
		].join("\n");
		expect(parseHunks(diff)).toEqual([{ start: 1, end: 1 }]);
	});

	it("collects every hunk of a multi-file diff in order", () => {
		const diff = [
			"diff --git a/a.ts b/a.ts",
			"@@ -1,2 +1,3 @@",
			"+x",
			"diff --git a/b.ts b/b.ts",
			"@@ -10 +10 @@",
			"@@ -20,1 +22,2 @@",
		].join("\n");
		expect(parseHunks(diff)).toEqual([
			{ start: 1, end: 3 },
			{ start: 10, end: 10 },
			{ start: 22, end: 23 },
		]);
	});

	it("returns an empty list for text without hunk headers", () => {
		expect(parseHunks("not a diff\n+++ b/file.ts\n--- a/file.ts")).toEqual([]);
		expect(parseHunks("")).toEqual([]);
	});
});
