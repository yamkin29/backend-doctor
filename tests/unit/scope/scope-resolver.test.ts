import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { ScopeResolution } from "../../../src/scope/resolve.js";
import { resolveScope } from "../../../src/scope/resolve.js";
import {
	commitAll,
	git,
	makeTempDir,
	makeTempRepo,
	removeFiles,
	writeFiles,
} from "./git-test-support.js";

function expectOk(
	resolution: ScopeResolution,
): Extract<ScopeResolution, { ok: true }>["scope"] {
	expect(resolution.ok, JSON.stringify(resolution)).toBe(true);
	if (!resolution.ok) throw new Error(resolution.error);
	return resolution.scope;
}

function sortedFiles(scope: { files: ReadonlySet<string> }): string[] {
	return [...scope.files].sort();
}

describe("resolveScope — changed mode", () => {
	it("changed set = tracked changes ∪ untracked, minus deletions and gitignored", async () => {
		const repo = makeTempRepo();
		writeFiles(repo, {
			"a.ts": "export const a = 1;\n",
			"b.ts": "export const b = 1;\n",
			"sub/c.ts": "export const c = 1;\n",
			".gitignore": "secret.ts\n",
		});
		commitAll(repo, "base");

		writeFiles(repo, {
			"a.ts": "export const a = 2;\n",
			"u.ts": "export const u = 1;\n",
			"secret.ts": "ignored\n",
		});
		removeFiles(repo, "b.ts");

		const scope = expectOk(
			await resolveScope({ target: repo, mode: "changed", base: "HEAD" }),
		);
		expect(sortedFiles(scope)).toEqual(
			[path.join(repo, "a.ts"), path.join(repo, "u.ts")].sort(),
		);
		expect(scope.mode).toBe("changed");
		expect(scope.base).toBe("HEAD");
	});

	it("counts commits made since the merge-base of --base and HEAD", async () => {
		const repo = makeTempRepo();
		writeFiles(repo, { "a.ts": "v1\n" });
		commitAll(repo, "a");
		const mainBranch = git(repo, "rev-parse", "--abbrev-ref", "HEAD").trim();

		git(repo, "checkout", "-q", "-b", "feature");
		writeFiles(repo, { "a.ts": "v2\n" });
		commitAll(repo, "b");

		git(repo, "checkout", "-q", mainBranch);
		writeFiles(repo, { "c.ts": "c\n" });
		commitAll(repo, "c");

		const scope = expectOk(
			await resolveScope({ target: repo, mode: "changed", base: "feature" }),
		);
		expect(sortedFiles(scope)).toEqual([path.join(repo, "c.ts")]);
	});

	it("restricts the set to a subdirectory scan target", async () => {
		const repo = makeTempRepo();
		writeFiles(repo, { "sub/a.ts": "a\n", "root.ts": "root\n" });
		commitAll(repo, "base");
		writeFiles(repo, { "sub/a.ts": "a2\n", "root.ts": "root2\n" });

		const scope = expectOk(
			await resolveScope({
				target: path.join(repo, "sub"),
				mode: "changed",
				base: "HEAD",
			}),
		);
		expect(sortedFiles(scope)).toEqual([path.join(repo, "sub", "a.ts")]);
	});

	it("accepts a single-file scan target", async () => {
		const repo = makeTempRepo();
		writeFiles(repo, { "a.ts": "a\n", "b.ts": "b\n" });
		commitAll(repo, "base");
		writeFiles(repo, { "a.ts": "a2\n", "b.ts": "b2\n" });

		const scope = expectOk(
			await resolveScope({
				target: path.join(repo, "a.ts"),
				mode: "changed",
				base: "HEAD",
			}),
		);
		expect(sortedFiles(scope)).toEqual([path.join(repo, "a.ts")]);
	});

	it("treats an unborn HEAD as everything-new", async () => {
		const repo = makeTempRepo();
		writeFiles(repo, { "a.ts": "a\n", "b.ts": "b\n" });

		const scope = expectOk(
			await resolveScope({ target: repo, mode: "changed", base: "HEAD" }),
		);
		expect(sortedFiles(scope)).toEqual(
			[path.join(repo, "a.ts"), path.join(repo, "b.ts")].sort(),
		);
	});

	it("returns an empty set when nothing changed", async () => {
		const repo = makeTempRepo();
		writeFiles(repo, { "a.ts": "a\n" });
		commitAll(repo, "base");

		const scope = expectOk(
			await resolveScope({ target: repo, mode: "changed", base: "HEAD" }),
		);
		expect(sortedFiles(scope)).toEqual([]);
	});

	it("reports an unresolvable --base", async () => {
		const repo = makeTempRepo();
		writeFiles(repo, { "a.ts": "a\n" });
		commitAll(repo, "base");

		const resolution = await resolveScope({
			target: repo,
			mode: "changed",
			base: "no-such-ref",
		});
		expect(resolution.ok).toBe(false);
		if (resolution.ok) throw new Error("expected failure");
		expect(resolution.error).toContain("no-such-ref");
	});

	it("reports a target outside any git work tree", async () => {
		const dir = makeTempDir();
		const resolution = await resolveScope({
			target: dir,
			mode: "changed",
			base: "HEAD",
		});
		expect(resolution.ok).toBe(false);
		if (resolution.ok) throw new Error("expected failure");
		expect(resolution.error).toContain("git work tree");
	});

	it("reports a missing common ancestor (unrelated histories)", async () => {
		const repo = makeTempRepo();
		writeFiles(repo, { "a.ts": "a\n" });
		commitAll(repo, "base");
		const mainBranch = git(repo, "rev-parse", "--abbrev-ref", "HEAD").trim();

		git(repo, "checkout", "-q", "--orphan", "other");
		writeFiles(repo, { "o.ts": "o\n" });
		commitAll(repo, "orphan");
		git(repo, "checkout", "-q", mainBranch);

		const resolution = await resolveScope({
			target: repo,
			mode: "changed",
			base: "other",
		});
		expect(resolution.ok).toBe(false);
		if (resolution.ok) throw new Error("expected failure");
		expect(resolution.error).toContain("common ancestor");
	});
});

describe("resolveScope — files mode", () => {
	it("builds the set from the given paths without touching git", async () => {
		const dir = makeTempDir(); // deliberately not a git repo
		const a = path.join(dir, "a.ts");
		fs.writeFileSync(a, "a\n");
		const scope = expectOk(
			await resolveScope({
				target: dir,
				mode: "files",
				base: "HEAD",
				files: [a],
			}),
		);
		expect(sortedFiles(scope)).toEqual([a]);
		expect(scope.mode).toBe("files");
		expect(scope.base).toBeUndefined();
	});
});
