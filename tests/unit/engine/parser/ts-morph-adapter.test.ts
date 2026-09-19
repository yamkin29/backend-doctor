import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TsMorphParserAdapter } from "../../../../src/engine/parser/ts-morph-adapter.js";
import { SyntaxKind } from "../../../../src/engine/parser/types.js";

let root: string;

beforeEach(() => {
	root = fs.mkdtempSync(path.join(os.tmpdir(), "backend-doctor-parser-"));
});

afterEach(() => {
	fs.rmSync(root, { recursive: true, force: true });
});

function write(relPath: string, content: string): string {
	const file = path.join(root, relPath);
	fs.mkdirSync(path.dirname(file), { recursive: true });
	fs.writeFileSync(file, content);
	return file;
}

describe("TsMorphParserAdapter (AC-2)", () => {
	it("parses ts, tsx and mts files into source file views", () => {
		const ts = write("src/index.ts", "const a = 1;\n");
		const tsx = write("src/app.tsx", "const el = <div>hi</div>;\n");
		const mts = write("src/mod.mts", "export const b = 2;\n");

		const adapter = new TsMorphParserAdapter();
		const { files } = adapter.createProject([ts, tsx, mts]);

		expect(files.map((f) => f.filePath).sort()).toEqual([ts, tsx, mts].sort());
	});

	it("exposes the parser name", () => {
		expect(new TsMorphParserAdapter().name).toBe("ts-morph");
	});

	it("positionOf returns 1-based line and column", () => {
		const file = write(
			"src/pos.ts",
			"const a = 1;\nconst b = 2;\n\nconst c = 3;\n",
		);
		const adapter = new TsMorphParserAdapter();
		const { files } = adapter.createProject([file]);
		const view = files.at(0);
		if (!view) throw new Error("expected the file to load");

		// Position of "const c" (third statement, after a blank line).
		const pos = view.getText().indexOf("const c");
		expect(adapter.positionOf(view, pos)).toEqual({ line: 4, column: 1 });
	});

	it("forEachDescendant visits nested nodes and honors the skip signal", () => {
		const file = write(
			"src/tree.ts",
			"function outer() { function inner() { return 1; } }\n",
		);
		const adapter = new TsMorphParserAdapter();
		const { files } = adapter.createProject([file]);
		const view = files.at(0);
		if (!view) throw new Error("expected the file to load");

		const kinds: string[] = [];
		view.forEachDescendant((node) => {
			if (node.getKind() === SyntaxKind.FunctionDeclaration) {
				kinds.push(node.getText().split("(")[0] ?? "");
				return "skip";
			}
		});

		expect(kinds).toEqual(["function outer"]);
	});

	it("surfaces unreadable files as failures without aborting the batch", () => {
		const good = write("src/good.ts", "const ok = true;\n");
		const missing = path.join(root, "src", "gone.ts");

		const adapter = new TsMorphParserAdapter();
		const { files, failures } = adapter.createProject([good, missing]);

		expect(files.map((f) => f.filePath)).toEqual([good]);
		expect(failures).toHaveLength(1);
		expect(failures[0]?.filePath).toBe(missing);
		expect(failures[0]?.reason).toContain("ENOENT");
	});

	it("surfaces binary files as failures", () => {
		const good = write("src/good.ts", "const ok = true;\n");
		const binary = write("src/logo.ts", "OK\u0000\u0001binary\u0000");

		const adapter = new TsMorphParserAdapter();
		const { files, failures } = adapter.createProject([good, binary]);

		expect(files.map((f) => f.filePath)).toEqual([good]);
		expect(failures).toHaveLength(1);
		expect(failures[0]?.filePath).toBe(binary);
		expect(failures[0]?.reason).toContain("binary");
	});

	it("getRelativePathTo returns a path relative to the given directory", () => {
		const file = write("src/rel.ts", "const x = 1;\n");
		const adapter = new TsMorphParserAdapter();
		const { files } = adapter.createProject([file]);

		expect(files[0]?.getRelativePathTo(root)).toBe(path.join("src", "rel.ts"));
	});

	it("getModuleSpecifiers collects static imports, require and dynamic import calls (AC-5)", () => {
		const file = write(
			"src/specifiers.ts",
			[
				'import express from "express";',
				'import type { Foo } from "foo-types";',
				'const fs = require("node:fs");',
				'const load = async () => (await import("./lazy.js")).default;',
				'const notAModule = "express"; // not a module reference',
				"// import from-a-comment",
				"export const all = [fs, load, notAModule];",
			].join("\n"),
		);
		const adapter = new TsMorphParserAdapter();
		const { files } = adapter.createProject([file]);
		const view = files.at(0);
		if (!view) throw new Error("expected the file to load");

		expect(view.getModuleSpecifiers()).toEqual([
			"express",
			"foo-types",
			"node:fs",
			"./lazy.js",
		]);
	});

	it("getModuleSpecifiers returns an empty list without module references", () => {
		const file = write("src/plain.ts", 'export const value = "express";\n');
		const adapter = new TsMorphParserAdapter();
		const { files } = adapter.createProject([file]);
		const view = files.at(0);
		if (!view) throw new Error("expected the file to load");

		expect(view.getModuleSpecifiers()).toEqual([]);
	});
});
