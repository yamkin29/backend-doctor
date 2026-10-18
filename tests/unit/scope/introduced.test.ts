import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { TsMorphParserAdapter } from "../../../src/engine/parser/ts-morph-adapter.js";
import { mapUnchangedLine } from "../../../src/scope/diff.js";
import { filterIntroduced } from "../../../src/scope/introduced.js";
import { diagnostic } from "../../helpers/console.js";
import { makeTempDir, writeFiles } from "./git-test-support.js";

describe("introduced occurrence matching (spec 030)", () => {
	const finding = (id: string, line: number, anchor = "eval(old)") => ({
		diagnostic: diagnostic({ id, line }),
		anchor,
	});
	it("omits shifted old findings and preserves the actual new diagnostic", () => {
		const old = finding("old", 2);
		const shifted = finding("shifted", 5);
		const added = finding("added", 6, "eval(new)");
		expect(filterIntroduced([shifted, added], [old])).toEqual([
			added.diagnostic,
		]);
	});
	it("consumes each occurrence once, preferring the old line correspondence", () => {
		const inserted = finding("inserted", 1);
		const shifted = finding("shifted", 2);
		expect(
			filterIntroduced([inserted, shifted], [finding("old", 1)], (line) =>
				line === 2 ? 1 : undefined,
			),
		).toEqual([inserted.diagnostic]);
	});
	it("never suppresses internal failures or findings without source evidence", () => {
		const internal = {
			...finding("internal", 1),
			diagnostic: diagnostic({ tags: ["internal"] }),
		};
		const unknown = { diagnostic: diagnostic({ id: "unknown" }) };
		expect(filterIntroduced([internal, unknown], [internal, unknown])).toEqual([
			internal.diagnostic,
			unknown.diagnostic,
		]);
	});
	it("does not equate different rules or messages", () => {
		const changed = {
			...finding("new", 1),
			diagnostic: diagnostic({ message: "different" }),
		};
		expect(filterIntroduced([changed], [finding("old", 1)])).toEqual([
			changed.diagnostic,
		]);
	});
});

describe("unchanged line mapping", () => {
	it("maps insertions, replacements and deletion-only hunks", () => {
		const diff = "@@ -0,0 +1,2 @@\n@@ -4,2 +6 @@\n@@ -9,2 +9,0 @@";
		expect(
			[1, 2, 3, 5, 6, 7, 9, 10].map((line) => mapUnchangedLine(diff, line)),
		).toEqual([undefined, undefined, 1, 3, undefined, 6, 8, 11]);
	});
});

describe("parser diagnostic anchors", () => {
	const dirs: string[] = [];
	afterEach(() => {
		for (const dir of dirs.splice(0))
			fs.rmSync(dir, { recursive: true, force: true });
	});
	function anchor(source: string, line: number, column: number) {
		const dir = makeTempDir();
		dirs.push(dir);
		writeFiles(dir, { "a.ts": source });
		const file = new TsMorphParserAdapter().createProject([
			path.join(dir, "a.ts"),
		]).files[0];
		return file?.getDiagnosticAnchor?.(line, column);
	}
	it("ignores trivia and positions but keeps substantive tokens", () => {
		const before = anchor('eval("old");\n', 1, 1);
		expect(before).toBeTruthy();
		expect(anchor('\n  eval( /* explanation */ "old" );\n', 2, 3)).toBe(before);
		expect(anchor('eval("new");\n', 1, 1)).not.toBe(before);
	});
	it("distinguishes individual statements on the same line", () => {
		const source = 'eval("old"); eval("new");';
		expect(anchor(source, 1, 1)).not.toBe(anchor(source, 1, 14));
	});
	it("preserves regex literal content that resembles comment trivia", () => {
		expect(anchor("eval(/[//]a/);", 1, 1)).not.toBe(
			anchor("eval(/[//]b/);", 1, 1),
		);
	});
});
