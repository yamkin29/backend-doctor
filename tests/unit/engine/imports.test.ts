import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	buildImportGraph,
	findEntryFiles,
	type ImportEdgeSource,
} from "../../../src/engine/imports.js";

function source(filePath: string, specifiers: string[]): ImportEdgeSource {
	return { filePath, getModuleSpecifiers: () => specifiers };
}

/** A fake project under /proj with the given files and import lists. */
function project(
	specifiersByFile: Record<string, string[]>,
): ImportEdgeSource[] {
	return Object.entries(specifiersByFile).map(([file, specifiers]) =>
		source(path.join("/proj/src", file), specifiers),
	);
}

const tempDirs: string[] = [];

function makeTempProject(files: string[]): {
	root: string;
	analyzed: Set<string>;
} {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "backend-doctor-imp-"));
	tempDirs.push(root);
	const analyzed = new Set<string>();
	for (const file of files) {
		const absolute = path.join(root, file);
		fs.mkdirSync(path.dirname(absolute), { recursive: true });
		fs.writeFileSync(absolute, "export {};\n");
		analyzed.add(absolute);
	}
	return { root, analyzed };
}

afterEach(() => {
	while (tempDirs.length > 0) {
		const dir = tempDirs.pop();
		if (dir) fs.rmSync(dir, { recursive: true, force: true });
	}
});

describe("buildImportGraph — edge resolution", () => {
	it("resolves extensionless, literal and .js→.ts specifiers", () => {
		const graph = buildImportGraph(
			project({
				"a.ts": ["./b", "./c.ts", "./d.js"],
				"b.ts": [],
				"c.ts": [],
				"d.ts": [],
			}),
		);
		expect(graph.files).toEqual([
			"/proj/src/a.ts",
			"/proj/src/b.ts",
			"/proj/src/c.ts",
			"/proj/src/d.ts",
		]);
		expect(graph.edgesOf("/proj/src/a.ts")).toEqual([
			"/proj/src/b.ts",
			"/proj/src/c.ts",
			"/proj/src/d.ts",
		]);
	});

	it("resolves .mjs/.cjs mappings and /index variants", () => {
		const graph = buildImportGraph(
			project({
				"a.ts": ["./b.mjs", "./c.cjs", "./util", "./util.js"],
				"b.mts": [],
				"c.cts": [],
				"util/index.ts": [],
			}),
		);
		expect(graph.edgesOf("/proj/src/a.ts")).toEqual([
			"/proj/src/b.mts",
			"/proj/src/c.cts",
			"/proj/src/util/index.ts",
		]);
	});

	it("drops bare specifiers, unresolvable paths and self-edges", () => {
		const graph = buildImportGraph(
			project({
				"a.ts": ["express", "@scope/pkg/sub", "./missing", "./a.js"],
				"b.ts": [],
			}),
		);
		expect(graph.edgesOf("/proj/src/a.ts")).toEqual([]);
		expect(graph.resolve("/proj/src/a.ts", "./b")).toBe("/proj/src/b.ts");
		expect(graph.resolve("/proj/src/a.ts", "./missing")).toBeUndefined();
		expect(graph.resolve("/proj/src/a.ts", "express")).toBeUndefined();
	});
});

describe("buildImportGraph — cycles", () => {
	it("finds a three-file ring as one canonical chain", () => {
		const graph = buildImportGraph(
			project({
				"a.ts": ["./b"],
				"b.ts": ["./c"],
				"c.ts": ["./a"],
			}),
		);
		expect(graph.cycles()).toEqual([
			["/proj/src/a.ts", "/proj/src/b.ts", "/proj/src/c.ts", "/proj/src/a.ts"],
		]);
	});

	it("finds disjoint rings ordered by smallest member", () => {
		const graph = buildImportGraph(
			project({
				// ring 2: m <-> n (smaller than the x/y/z ring by path sort)
				"m.ts": ["./n"],
				"n.ts": ["./m"],
				"x.ts": ["./y"],
				"y.ts": ["./z"],
				"z.ts": ["./x"],
			}),
		);
		expect(graph.cycles()).toEqual([
			["/proj/src/m.ts", "/proj/src/n.ts", "/proj/src/m.ts"],
			["/proj/src/x.ts", "/proj/src/y.ts", "/proj/src/z.ts", "/proj/src/x.ts"],
		]);
	});

	it("returns no cycles for an acyclic graph", () => {
		const graph = buildImportGraph(
			project({
				"a.ts": ["./b"],
				"b.ts": ["./c"],
				"c.ts": [],
			}),
		);
		expect(graph.cycles()).toEqual([]);
	});
});

describe("findEntryFiles + reachability", () => {
	it("detects main, bin and conventional entries against the analyzed set", () => {
		const { root, analyzed } = makeTempProject([
			"dist/main.js",
			"dist/cli.js",
			"dist/other.js",
			"src/main.ts",
			"src/index.ts",
		]);
		const entries = findEntryFiles(root, analyzed, {
			main: "dist/main.js",
			bin: { "backend-doctor": "./dist/cli.js" },
		});
		expect(entries).toEqual([
			path.join(root, "dist/cli.js"),
			path.join(root, "dist/main.js"),
			path.join(root, "src/index.ts"),
			path.join(root, "src/main.ts"),
		]);
	});

	it("keeps only entries that exist in the analyzed set", () => {
		const { root, analyzed } = makeTempProject(["src/app.ts"]);
		expect(findEntryFiles(root, analyzed, { main: "dist/main.js" })).toEqual(
			[],
		);
	});

	it("reachability spans transitive imports", () => {
		const graph = buildImportGraph(
			project({
				"main.ts": ["./users/service"],
				"users/service.ts": ["../shared/util"],
				"shared/util.ts": [],
				"orphan.ts": [],
			}),
		);
		const reachable = graph.reachableFrom(["/proj/src/main.ts"]);
		expect(reachable.has("/proj/src/main.ts")).toBe(true);
		expect(reachable.has("/proj/src/users/service.ts")).toBe(true);
		expect(reachable.has("/proj/src/shared/util.ts")).toBe(true);
		expect(reachable.has("/proj/src/orphan.ts")).toBe(false);
	});

	it("degenerate inputs stay empty", () => {
		const graph = buildImportGraph([]);
		expect(graph.files).toEqual([]);
		expect(graph.cycles()).toEqual([]);
		expect(graph.reachableFrom([]).size).toBe(0);
	});
});
