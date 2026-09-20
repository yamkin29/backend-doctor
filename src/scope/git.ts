import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const MAX_BUFFER = 16 * 1024 * 1024;

export type GitOutput =
	| { ok: true; stdout: string }
	| { ok: false; kind: "missing-git" }
	| { ok: false; kind: "git-error"; detail: string };

/**
 * The only place backend-doctor spawns git (spec 015): execFile, never a
 * shell. A missing binary is distinguished from a failing command so the CLI
 * can say "git is not available" instead of quoting git's stderr.
 */
export async function runGit(
	cwd: string,
	args: readonly string[],
): Promise<GitOutput> {
	try {
		const { stdout } = await execFileAsync("git", [...args], {
			cwd,
			maxBuffer: MAX_BUFFER,
		});
		return { ok: true, stdout };
	} catch (error) {
		const err = error as NodeJS.ErrnoException & { stderr?: string };
		if (err.code === "ENOENT") return { ok: false, kind: "missing-git" };
		return {
			ok: false,
			kind: "git-error",
			detail: (err.stderr ?? err.message).trim(),
		};
	}
}

/** Splits `-z` output (NUL-separated entries with a trailing NUL). */
export function nulFields(stdout: string): string[] {
	return stdout.split("\0").filter((field) => field.length > 0);
}
