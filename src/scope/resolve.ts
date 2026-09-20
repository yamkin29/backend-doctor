import fs from "node:fs";
import path from "node:path";
import { parseHunks } from "./diff.js";
import { nulFields, runGit } from "./git.js";
import type { LineRange, ResolvedScope, ScopeMode } from "./types.js";

export interface ScopeRequest {
	/** Absolute scan target (directory or file). */
	target: string;
	mode: ScopeMode;
	/** Git ref the diff is computed against (merge-base with HEAD). */
	base: string;
	/** Absolute paths for `files` scope. */
	files?: readonly string[];
}

export type ScopeResolution =
	| { ok: true; scope: ResolvedScope }
	| { ok: false; error: string };

const GIT_MISSING =
	"git is not available on PATH (required for --scope changed/lines)";

/**
 * Resolves the CLI scope flags against the repository (spec 015). Every git
 * command runs with the work-tree toplevel as cwd — the only base that makes
 * `diff --name-only` and `ls-files --others` emit paths in the same form —
 * and the resulting absolute paths are restricted to the scan target's
 * subtree. Git reports the toplevel in canonical (realpath) form, which on
 * macOS differs from `os.tmpdir()` spelling (`/var` ↔ `/private/var`), so
 * both sides are canonicalized for comparison and mapped back to the
 * target's spelling for the engine. A failure is a reported
 * usage-environment error (exit 2 via the CLI), never a silent fallback to
 * a full scan (constitution §8).
 */
export async function resolveScope(
	request: ScopeRequest,
): Promise<ScopeResolution> {
	if (request.mode === "files") {
		return {
			ok: true,
			scope: {
				mode: "files",
				files: new Set(request.files ?? []),
				lineRanges: new Map(),
			},
		};
	}

	const isFileTarget = fs.statSync(request.target).isFile();
	const scopeRoot = isFileTarget
		? path.dirname(request.target)
		: request.target;
	const realScopeRoot = fs.realpathSync(scopeRoot);
	// A file target admits exactly that file; a directory target admits its
	// whole subtree. Both tests run in canonical (realpath) space.
	const realFileTarget = isFileTarget ? fs.realpathSync(request.target) : null;
	const admits = (abs: string): boolean =>
		realFileTarget !== null
			? abs === realFileTarget
			: isInsideTarget(realScopeRoot, abs);

	const toplevel = await runGit(realScopeRoot, [
		"rev-parse",
		"--show-toplevel",
	]);
	if (!toplevel.ok) {
		return {
			ok: false,
			error:
				toplevel.kind === "missing-git"
					? GIT_MISSING
					: `not inside a git work tree: ${request.target}`,
		};
	}
	const top = fs.realpathSync(toplevel.stdout.trim());

	const baseResolves = await refResolves(top, request.base);
	let tracked: string[];
	// Defined whenever there is history to diff against; `lines` mode needs
	// it later, and unborn cases leave it undefined with `tracked` empty.
	let mergeBase: string | undefined;
	if (baseResolves) {
		// Design decision 7b: a valid --base but unborn HEAD — there is no
		// history to merge against, so every file counts as new.
		if (!(await refResolves(top, "HEAD"))) {
			tracked = [];
		} else {
			const mergeBaseOut = await runGit(top, [
				"merge-base",
				request.base,
				"HEAD",
			]);
			if (!mergeBaseOut.ok) {
				return {
					ok: false,
					error: `no common ancestor between "${request.base}" and HEAD in ${top}`,
				};
			}
			mergeBase = mergeBaseOut.stdout.trim();
			const changed = await runGit(top, [
				"diff",
				"--name-only",
				"--diff-filter=d",
				"-z",
				"--no-color",
				"--no-ext-diff",
				"--no-textconv",
				mergeBase,
			]);
			if (!changed.ok) {
				return {
					ok: false,
					error:
						changed.kind === "missing-git"
							? GIT_MISSING
							: `git diff --name-only failed: ${changed.detail}`,
				};
			}
			tracked = nulFields(changed.stdout);
		}
	} else if (request.base === "HEAD") {
		// Design decision 7a: unborn repository — nothing is tracked, every
		// collected file is new.
		tracked = [];
	} else {
		return {
			ok: false,
			error: `--base "${request.base}" does not resolve in ${top}`,
		};
	}

	const untracked = await runGit(top, [
		"ls-files",
		"--others",
		"--exclude-standard",
		"-z",
	]);
	if (!untracked.ok) {
		return {
			ok: false,
			error:
				untracked.kind === "missing-git"
					? GIT_MISSING
					: `git ls-files failed: ${untracked.detail}`,
		};
	}

	const files = [...tracked, ...nulFields(untracked.stdout)]
		.map((rel) => path.join(top, rel))
		.filter(admits)
		.map((abs) => path.join(scopeRoot, path.relative(realScopeRoot, abs)));

	const lineRanges = new Map<string, readonly LineRange[]>();
	if (request.mode === "lines" && mergeBase !== undefined) {
		for (const rel of tracked.filter((rel) => admits(path.join(top, rel)))) {
			const diff = await runGit(top, [
				"diff",
				"--no-color",
				"--no-ext-diff",
				"--no-textconv",
				"-U0",
				mergeBase,
				"--",
				rel,
			]);
			if (!diff.ok) {
				return {
					ok: false,
					error:
						diff.kind === "missing-git"
							? GIT_MISSING
							: `git diff -U0 failed for ${rel}: ${diff.detail}`,
				};
			}
			// Tracked changed files always get an entry — empty means no
			// line-level change, so every diagnostic in the file is filtered.
			// Untracked files get none: their whole content counts as changed.
			lineRanges.set(
				path.join(scopeRoot, path.relative(realScopeRoot, path.join(top, rel))),
				parseHunks(diff.stdout),
			);
		}
	}

	return {
		ok: true,
		scope: {
			mode: request.mode,
			files: new Set(files),
			lineRanges,
			base: request.base,
		},
	};
}

async function refResolves(top: string, ref: string): Promise<boolean> {
	const out = await runGit(top, ["rev-parse", "--verify", "--quiet", ref]);
	return out.ok;
}

function isInsideTarget(target: string, filePath: string): boolean {
	if (filePath === target) return true;
	const rel = path.relative(target, filePath);
	return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
}
