import fs from "node:fs";
import path from "node:path";
import picomatch from "picomatch";

/** Extensions the engine parses in F003 (spec 003, file collection). */
export const SUPPORTED_EXTENSIONS = [".ts", ".tsx", ".mts", ".cts"] as const;

/**
 * Default excludes, matched against target-relative paths (spec 003). Users
 * still write their own globs against the same relative paths.
 */
export const DEFAULT_EXCLUDES = [
	"node_modules/**",
	"dist/**",
	"build/**",
	"coverage/**",
	".git/**",
] as const;

export interface CollectOptions {
	/** Absolute path of the scan target (directory or file). */
	target: string;
	/** File extensions to include, with leading dot (e.g. ".ts"). */
	extensions: readonly string[];
	/** Exclude globs (default excludes), matched target-relative. */
	excludes: readonly string[];
	/** Ignore globs from config ignore.files ∪ CLI --ignore. */
	ignoreGlobs: readonly string[];
}

/**
 * Collects files under the scan target, sorted for deterministic report
 * order (design decision 2). Globs match with picomatch `dot: true` against
 * paths relative to the target. Matching directories are pruned from the
 * walk; directory symlinks are never followed.
 */
export function collectFiles(opts: CollectOptions): string[] {
	const isMatch = picomatch([...opts.excludes, ...opts.ignoreGlobs], {
		dot: true,
	});

	if (fs.statSync(opts.target).isFile()) {
		if (!hasSupportedExtension(opts.target, opts.extensions)) return [];
		if (isMatch(path.basename(opts.target))) return [];
		return [opts.target];
	}

	const files: string[] = [];
	walk(path.resolve(opts.target), isMatch, opts.extensions, "", files);
	return files.sort(comparePaths);
}

function walk(
	dir: string,
	isMatch: (candidate: string) => boolean,
	extensions: readonly string[],
	prefix: string,
	out: string[],
): void {
	const entries = fs.readdirSync(dir, { withFileTypes: true });
	for (const entry of entries) {
		const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
		if (entry.isDirectory()) {
			// Prune whole directories matching the globs, so an "x/**" pattern
			// stops the walk instead of only excluding the files found inside.
			if (isMatch(relative) || isMatch(`${relative}/__probe__`)) continue;
			walk(path.join(dir, entry.name), isMatch, extensions, relative, out);
		} else if (entry.isFile()) {
			if (!hasSupportedExtension(entry.name, extensions)) continue;
			if (isMatch(relative)) continue;
			out.push(path.join(dir, entry.name));
		}
	}
}

function hasSupportedExtension(
	file: string,
	extensions: readonly string[],
): boolean {
	return extensions.some((ext) => file.endsWith(ext));
}

function comparePaths(a: string, b: string): number {
	return a < b ? -1 : a > b ? 1 : 0;
}
