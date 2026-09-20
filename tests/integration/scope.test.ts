import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { defaultConfig } from "../../src/config/types.js";
import { runScan } from "../../src/core/scan.js";
import type { LineRange, ResolvedScope } from "../../src/scope/types.js";

/**
 * Spec 015: how runScan consumes a resolved scope — file-set intersection,
 * line filtering, and the visible project-rules skip (constitution §8).
 * Scopes are hand-built here; their resolution from git is covered in
 * tests/unit/scope and end-to-end in tests/e2e/diff-scope.test.ts.
 */

function writeProject(): string {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "backend-doctor-scope-"));
	fs.writeFileSync(
		path.join(root, "package.json"),
		JSON.stringify({
			name: "app",
			dependencies: { "left-pad": "^1.3.0" },
		}),
	);
	const src = path.join(root, "src");
	fs.mkdirSync(src, { recursive: true });
	for (const name of ["a.ts", "b.ts", "c.ts"]) {
		fs.writeFileSync(
			path.join(src, name),
			["export function f(): void {", '\teval("1");', "}"].join("\n"),
		);
	}
	return root;
}

function scope(partial: Partial<ResolvedScope>): ResolvedScope {
	return {
		mode: "changed",
		files: new Set<string>(),
		lineRanges: new Map<string, readonly LineRange[]>(),
		...partial,
	};
}

function rel(result: { input: { directory: string } }, filePath: string) {
	return path
		.relative(result.input.directory, filePath)
		.split(path.sep)
		.join("/");
}

describe("runScan with a resolved scope (spec 015)", () => {
	it("analyzes only the scoped file set and skips project rules loudly", async () => {
		const root = writeProject();
		try {
			const result = await runScan({
				directory: root,
				ignore: [],
				config: defaultConfig(),
				scope: scope({
					mode: "files",
					files: new Set([path.join(root, "src/a.ts")]),
				}),
			});

			expect(
				result.diagnostics.map((d) => [
					rel(result, d.filePath),
					d.line,
					d.rule,
				]),
			).toEqual([["src/a.ts", 2, "backend-doctor/no-eval"]]);
			expect(result.projects[0]?.analyzedFiles).toEqual(["src/a.ts"]);
			expect(result.projects[0]?.analyzedFileCount).toBe(1);
			expect(result.projects[0]?.complete).toBe(false);
			expect(result.projects[0]?.skippedChecks).toEqual([
				{
					check: "project-rules",
					reason: expect.stringContaining("files"),
				},
			]);
		} finally {
			fs.rmSync(root, { recursive: true, force: true });
		}
	});

	it("filters lines-scope diagnostics to changed hunks, keeping untracked files whole", async () => {
		const root = writeProject();
		try {
			// a.ts: line 2 changed (diagnostic kept); b.ts: tracked but no
			// line-level change (diagnostic filtered); c.ts: untracked — no
			// map entry, whole file counts as changed (diagnostic kept).
			const result = await runScan({
				directory: root,
				ignore: [],
				config: defaultConfig(),
				scope: scope({
					mode: "lines",
					files: new Set([
						path.join(root, "src/a.ts"),
						path.join(root, "src/b.ts"),
						path.join(root, "src/c.ts"),
					]),
					lineRanges: new Map([
						[path.join(root, "src/a.ts"), [{ start: 2, end: 2 }]],
						[path.join(root, "src/b.ts"), []],
					]),
				}),
			});

			expect(
				result.diagnostics.map((d) => [
					rel(result, d.filePath),
					d.line,
					d.rule,
				]),
			).toEqual([
				["src/a.ts", 2, "backend-doctor/no-eval"],
				["src/c.ts", 2, "backend-doctor/no-eval"],
			]);
			expect(result.projects[0]?.complete).toBe(false);
			expect(result.projects[0]?.skippedChecks).toEqual([
				{
					check: "project-rules",
					reason: expect.stringContaining("lines"),
				},
			]);
		} finally {
			fs.rmSync(root, { recursive: true, force: true });
		}
	});

	it("keeps the pre-015 full pipeline when no scope is given", async () => {
		const root = writeProject();
		try {
			const result = await runScan({
				directory: root,
				ignore: [],
				config: defaultConfig(),
			});

			// Per-file findings on all three files plus the project pass
			// (unused-dependency, and the unimported exports are dead too).
			expect(result.diagnostics.map((d) => d.rule)).toContain(
				"backend-doctor/unused-dependency",
			);
			expect(
				result.diagnostics.filter((d) => d.rule === "backend-doctor/no-eval"),
			).toHaveLength(3);
			expect(result.projects[0]?.complete).toBe(true);
			expect(
				result.projects[0]?.skippedChecks.filter(
					(entry) => entry.check === "project-rules",
				),
			).toEqual([]);
		} finally {
			fs.rmSync(root, { recursive: true, force: true });
		}
	});
});
