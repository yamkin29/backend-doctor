import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	collectFiles,
	DEFAULT_EXCLUDES,
	SUPPORTED_EXTENSIONS,
} from "../../../src/engine/collect.js";

let root: string;

beforeEach(() => {
	root = fs.mkdtempSync(path.join(os.tmpdir(), "backend-doctor-collect-"));
});

afterEach(() => {
	fs.rmSync(root, { recursive: true, force: true });
});

/** Creates a file (and any missing parent directories) relative to the root. */
function touch(relPath: string, content = ""): string {
	const file = path.join(root, relPath);
	fs.mkdirSync(path.dirname(file), { recursive: true });
	fs.writeFileSync(file, content);
	return file;
}

function collect(ignoreGlobs: string[] = [], target?: string): string[] {
	return collectFiles({
		target: target ?? root,
		extensions: SUPPORTED_EXTENSIONS,
		excludes: DEFAULT_EXCLUDES,
		ignoreGlobs,
	}).map((file) => path.relative(root, file));
}

describe("collectFiles (AC-1)", () => {
	it("collects supported extensions recursively and sorts the output", () => {
		touch("src/a.ts");
		touch("src/nested/b.tsx");
		touch("scripts/c.mts");
		touch("d.cts");

		expect(collect()).toEqual([
			"d.cts",
			path.join("scripts", "c.mts"),
			path.join("src", "a.ts"),
			path.join("src", "nested", "b.tsx"),
		]);
	});

	it("skips unsupported extensions", () => {
		touch("src/index.ts");
		touch("src/style.css");
		touch("README.md");
		touch("src/data.json");
		touch("src/legacy.js");

		expect(collect()).toEqual([path.join("src", "index.ts")]);
	});

	it("excludes default exclude directories", () => {
		touch("node_modules/pkg/index.ts");
		touch("dist/bundle.ts");
		touch("build/out.ts");
		touch("coverage/lcov-report/index.ts");
		touch(".git/hooks/pre-commit.sample.ts");
		touch("src/app.ts");

		expect(collect()).toEqual([path.join("src", "app.ts")]);
	});

	it("scans dot directories by default (only globs exclude them)", () => {
		touch("src/.cache/gen.ts");

		expect(collect()).toEqual([path.join("src", ".cache", "gen.ts")]);
	});

	it("dot: true lets plain ignore globs also match dotfiles", () => {
		touch("src/.cache/gen.ts");
		touch("src/app.ts");

		// Without dot: true, "**" would refuse to traverse into ".cache",
		// so "**/gen.ts" would not match "src/.cache/gen.ts".
		expect(collect(["**/gen.ts"])).toEqual([path.join("src", "app.ts")]);
	});

	it("applies ignore globs from config/CLI against target-relative paths", () => {
		touch("src/generated/schema.ts");
		touch("src/generated/other.ts");
		touch("src/keep.ts");

		expect(collect(["**/generated/**"])).toEqual([path.join("src", "keep.ts")]);
	});

	it("unions default excludes with the given ignore globs", () => {
		touch("node_modules/pkg/index.ts");
		touch("src/generated/schema.ts");
		touch("src/app.ts");

		expect(collect(["**/generated/**"])).toEqual([path.join("src", "app.ts")]);
	});

	it("does not descend into excluded directories (prunes the walk)", () => {
		touch("node_modules/pkg/deep/index.ts");
		// A sentinel that would be collected if the walk entered node_modules.
		fs.writeFileSync(
			path.join(root, "node_modules", "pkg", "deep", "x.ts"),
			"",
		);

		expect(collect()).toEqual([]);
	});

	it("returns an empty list for a directory with no matching files", () => {
		touch("README.md");
		expect(collect()).toEqual([]);
	});

	it("collects a single file when the target is a file", () => {
		const file = touch("src/index.ts");
		expect(collect([], file)).toEqual([path.join("src", "index.ts")]);
	});

	it("ignores a file target with an unsupported extension", () => {
		const file = touch("src/index.js");
		expect(collect([], file)).toEqual([]);
	});

	it("matches ignore globs against a file target's basename", () => {
		const file = touch("src/schema.ts");
		expect(collect(["schema.ts"], file)).toEqual([]);
		expect(collect([], file)).toEqual([path.join("src", "schema.ts")]);
	});

	it("handles deeply nested trees deterministically across runs", () => {
		touch("a/b/c/d.ts");
		touch("a/b/e.ts");
		const first = collect();
		const second = collect();
		expect(first).toEqual(second);
		expect(first).toEqual([
			path.join("a", "b", "c", "d.ts"),
			path.join("a", "b", "e.ts"),
		]);
	});
});
