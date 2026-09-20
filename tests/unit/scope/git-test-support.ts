import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Temp-git-repo support for scope tests (spec 015): deterministic identity
 * via `-c user.name/-c user.email`, everything under os.tmpdir(), nothing
 * committed from tests/fixtures.
 */

/** Runs git in `cwd`, hiding git's stderr hints; throws on failure. */
export function git(cwd: string, ...args: string[]): string {
	return execFileSync("git", args, {
		cwd,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
	});
}

export function makeTempDir(): string {
	return fs.mkdtempSync(path.join(os.tmpdir(), "bd-scope-"));
}

/** Empty git repository (no commits — HEAD is unborn). */
export function makeTempRepo(): string {
	const dir = makeTempDir();
	git(dir, "init", "-q");
	return dir;
}

export function writeFiles(cwd: string, files: Record<string, string>): void {
	for (const [rel, content] of Object.entries(files)) {
		const abs = path.join(cwd, rel);
		fs.mkdirSync(path.dirname(abs), { recursive: true });
		fs.writeFileSync(abs, content);
	}
}

export function removeFiles(cwd: string, ...rels: string[]): void {
	for (const rel of rels) fs.rmSync(path.join(cwd, rel));
}

/** Stages everything not gitignored and commits with a fixed identity. */
export function commitAll(cwd: string, message: string): void {
	git(cwd, "add", "-A");
	git(
		cwd,
		"-c",
		"user.name=bd-test",
		"-c",
		"user.email=bd-test@example.com",
		"commit",
		"-q",
		"-m",
		message,
	);
}
