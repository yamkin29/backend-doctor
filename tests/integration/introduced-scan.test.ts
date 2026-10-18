import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultConfig } from "../../src/config/types.js";
import { runScan } from "../../src/core/scan.js";
import { allRules } from "../../src/engine/registry.js";
import { compareIntroduced } from "../../src/scope/baseline.js";
import { resolveScope } from "../../src/scope/resolve.js";
import {
	commitAll,
	git,
	makeTempRepo,
	writeFiles,
} from "../unit/scope/git-test-support.js";

describe("introduced scans against real Git objects (spec 030)", () => {
	const dirs: string[] = [];
	afterEach(() => {
		for (const dir of dirs.splice(0))
			fs.rmSync(dir, { recursive: true, force: true });
	});
	function repo(files: Record<string, string>) {
		const dir = fs.realpathSync(makeTempRepo());
		dirs.push(dir);
		writeFiles(dir, { "package.json": '{"name":"test"}', ...files });
		commitAll(dir, "baseline");
		return dir;
	}
	async function scan(
		directory: string,
		base = "HEAD",
		target = directory,
		config = defaultConfig(),
	) {
		const resolution = await resolveScope({ target, mode: "introduced", base });
		if (!resolution.ok) throw new Error(resolution.error);
		const result = await runScan({
			directory: target,
			ignore: config.ignore.files,
			config,
			scope: resolution.scope,
			captureAnchors: true,
		});
		await compareIntroduced(result);
		return result;
	}
	it("omits old shifted/trivia-edited findings and preserves new and duplicated occurrences", async () => {
		const dir = repo({ "a.ts": 'eval("old");\neval("same");\n' });
		writeFiles(dir, {
			"a.ts":
				'// added\n  eval( /* note */ "old" );\neval("same");\neval("same");\neval("new");\n',
		});
		const result = await scan(dir);
		expect(result.diagnostics.map((d) => d.line)).toEqual([4, 5]);
		expect(result.projects[0]?.skippedChecks.map((s) => s.check)).toEqual([
			"project-rules",
		]);
	});
	it("pairs renamed files without modifying working files, the index or branch", async () => {
		const dir = repo({ "old.ts": 'eval("old");\n' });
		git(dir, "mv", "old.ts", "new.ts");
		writeFiles(dir, { "new.ts": 'eval("old");\neval("new");\n' });
		const before = git(dir, "status", "--porcelain=v1");
		const index = git(dir, "ls-files", "--stage");
		const branch = git(dir, "symbolic-ref", "HEAD");
		const result = await scan(dir);
		expect(
			result.diagnostics.map((d) => [path.basename(d.filePath), d.line]),
		).toEqual([["new.ts", 2]]);
		expect(git(dir, "status", "--porcelain=v1")).toBe(before);
		expect(git(dir, "ls-files", "--stage")).toBe(index);
		expect(git(dir, "symbolic-ref", "HEAD")).toBe(branch);
		expect(fs.readFileSync(path.join(dir, "new.ts"), "utf8")).toBe(
			'eval("old");\neval("new");\n',
		);
	});
	it("keeps new files, excludes ignored/unsupported/outside/deleted files and respects subdirectory targets", async () => {
		const dir = repo({
			"sub/a.ts": 'eval("old");',
			"gone.ts": 'eval("gone");',
			".gitignore": "ignored.ts\n",
		});
		fs.unlinkSync(path.join(dir, "gone.ts"));
		writeFiles(dir, {
			"sub/a.ts": '// added\neval("old");',
			"sub/new.ts": 'eval("new");',
			"other.ts": 'eval("outside");',
			"ignored.ts": 'eval("ignored");',
			"sub/a.js": 'eval("js");',
		});
		const result = await scan(dir, "HEAD", path.join(dir, "sub"));
		expect(result.diagnostics.map((d) => path.basename(d.filePath))).toEqual([
			"new.ts",
		]);
	});
	it("uses the current configuration without executing historical configuration", async () => {
		const dir = repo({
			"a.ts": 'eval("old");',
			"backend-doctor.config.ts":
				'throw new Error("historical config executed");',
		});
		writeFiles(dir, {
			"a.ts": '// shift\neval("old");\neval("new");',
			"backend-doctor.config.ts": "export default {};",
		});
		const config = defaultConfig();
		config.rules["backend-doctor/no-eval"] = "off";
		expect((await scan(dir, "HEAD", dir, config)).diagnostics).toEqual([]);
	});
	it("retains candidates and visibly reports baseline syntax failures without temporary paths", async () => {
		const dir = repo({ "a.ts": "function broken( {" });
		writeFiles(dir, { "a.ts": 'eval("new");' });
		const result = await scan(dir);
		expect(result.diagnostics).toHaveLength(1);
		expect(result.projects[0]?.skippedChecks).toContainEqual({
			check: "baseline-comparison",
			reason: expect.stringContaining("unverified candidates"),
		});
		expect(JSON.stringify(result.projects)).not.toContain("bd-baseline-");
	});
	it("uses the merge-base instead of the tip of a diverged base branch", async () => {
		const dir = repo({ "a.ts": 'eval("common");' });
		git(dir, "branch", "base");
		writeFiles(dir, { "a.ts": 'eval("common");\neval("branch");' });
		commitAll(dir, "branch finding");
		const currentBranch = git(dir, "branch", "--show-current").trim();
		git(dir, "checkout", "-q", "base");
		writeFiles(dir, { "a.ts": 'eval("common");\neval("branch");' });
		commitAll(dir, "independent base finding");
		git(dir, "checkout", "-q", currentBranch);
		const result = await scan(dir, "base");
		expect(result.diagnostics.map((d) => d.line)).toEqual([2]);
	});
	it("does not inherit baseline occurrences for copies in new files or substantive edits", async () => {
		const dir = repo({ "a.ts": 'eval("old");\n' });
		writeFiles(dir, {
			"a.ts": 'eval("edited");\n',
			"copy.ts": 'eval("old");\n',
		});
		expect(
			(await scan(dir)).diagnostics.map((d) => path.basename(d.filePath)),
		).toEqual(["a.ts", "copy.ts"]);
	});
	it("does not reuse a renamed file's baseline for a recreated old path", async () => {
		const dir = repo({ "old.ts": 'eval("old");\n' });
		git(dir, "mv", "old.ts", "renamed.ts");
		writeFiles(dir, { "old.ts": 'eval("old");\n' });
		expect(
			(await scan(dir)).diagnostics.map((d) => path.basename(d.filePath)),
		).toEqual(["old.ts"]);
	});
	it("preserves package context and accepts a single renamed file target", async () => {
		const dir = repo({
			"sub/package.json": '{"dependencies":{"@prisma/client":"6"}}',
			"sub/a.ts": "const db = new PrismaClient();\ndb.user.findMany();\n",
		});
		git(dir, "mv", "sub/a.ts", "sub/renamed.ts");
		const result = await scan(dir, "HEAD", path.join(dir, "sub/renamed.ts"));
		expect(result.diagnostics).toEqual([]);
		expect(result.projects[0]?.frameworks).toContain("prisma");
	});
	it("reports historical symlinks without following or executing them and cleans up snapshots", async () => {
		const dir = repo({ "a.ts": 'eval("old");' });
		fs.symlinkSync("outside.json", path.join(dir, "tsconfig.json"));
		commitAll(dir, "symlink metadata");
		fs.unlinkSync(path.join(dir, "tsconfig.json"));
		writeFiles(dir, { "a.ts": 'eval("new");', "tsconfig.json": "{}" });
		const original = fs.mkdtempSync;
		const snapshots: string[] = [];
		const spy = vi
			.spyOn(fs, "mkdtempSync")
			.mockImplementation((...args: Parameters<typeof fs.mkdtempSync>) => {
				const created = original(...args);
				if (String(args[0]).includes("bd-baseline-"))
					snapshots.push(String(created));
				return created;
			});
		try {
			const result = await scan(dir);
			expect(result.diagnostics).toHaveLength(1);
			expect(result.projects[0]?.skippedChecks).toContainEqual({
				check: "baseline-comparison",
				reason: expect.stringContaining("symlinks are not followed"),
			});
			expect(snapshots.length).toBeGreaterThan(0);
			for (const snapshot of snapshots)
				expect(fs.existsSync(snapshot)).toBe(false);
		} finally {
			spy.mockRestore();
		}
	});
	it("normalizes a symlinked scan directory while preserving current diagnostic paths", async () => {
		const dir = repo({ "a.ts": 'eval("old");' });
		const aliasRoot = fs.realpathSync(makeTempRepo());
		dirs.push(aliasRoot);
		const alias = path.join(aliasRoot, "alias");
		fs.symlinkSync(dir, alias, "dir");
		writeFiles(dir, { "a.ts": '// shift\neval("old");\neval("new");' });
		const result = await scan(dir, "HEAD", alias);
		expect(result.diagnostics.map((d) => d.line)).toEqual([3]);
		expect(result.diagnostics[0]?.filePath).toBe(path.join(alias, "a.ts"));
	});
	it("retains candidates if snapshot creation fails", async () => {
		const dir = repo({ "a.ts": 'eval("old");' });
		writeFiles(dir, { "a.ts": 'eval("new");' });
		const spy = vi.spyOn(fs, "mkdtempSync").mockImplementationOnce(() => {
			throw Object.assign(new Error("disk full"), { code: "ENOSPC" });
		});
		try {
			const result = await scan(dir);
			expect(result.diagnostics).toHaveLength(1);
			expect(result.projects[0]?.skippedChecks).toContainEqual({
				check: "baseline-comparison",
				reason: expect.stringContaining("snapshot"),
			});
		} finally {
			spy.mockRestore();
		}
	});
	it("reports a baseline rule failure without suppressing current findings", async () => {
		const dir = repo({ "a.ts": 'eval("old");' });
		writeFiles(dir, { "a.ts": 'eval("new");' });
		const rule = allRules().find(
			(item) => item.id === "backend-doctor/no-eval",
		);
		if (!rule) throw new Error("Missing eval rule");
		const original = rule.create;
		const spy = vi.spyOn(rule, "create").mockImplementation((ctx) => {
			if (ctx.file.getText().includes('"old"'))
				throw new Error("baseline-only failure");
			original(ctx);
		});
		try {
			const result = await scan(dir);
			expect(result.diagnostics).toHaveLength(1);
			expect(result.projects[0]?.skippedChecks).toContainEqual({
				check: "baseline-comparison",
				reason: expect.stringContaining("baseline-only failure"),
			});
		} finally {
			spy.mockRestore();
		}
	});
});
