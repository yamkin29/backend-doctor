import picomatch from "picomatch";

/**
 * Approximate gitignore coverage for root-level files (spec 014 design §5):
 * the semantics a fixed set of root-level dotenv candidates needs, not a
 * full gitignore implementation. Lines match in order with LAST match
 * winning (git semantics); `!pattern` negation un-covers; a trailing `/`
 * marks a directory-only pattern and never matches a file; a leading `/`
 * is stripped; glob lines match via picomatch with `dot: true` (plus a
 * globstar-prefixed attempt, so a `**` + `/.env` pattern covers a
 * root-level `.env`); any other line matches by exact basename. Comments,
 * blank lines, surrounding whitespace and a UTF-8 BOM are skipped.
 * Patterns anchored to a nested directory (`config/.env`) never match a
 * root-level candidate.
 */

const GLOB_META = /[*?[]/;

export function isCoveredByGitignore(
	basename: string,
	content: string,
): boolean {
	let covered = false;
	const text = content.replace(/^\uFEFF/, "");
	for (const rawLine of text.split(/\r?\n/)) {
		const line = rawLine.trim();
		if (line === "" || line.startsWith("#")) continue;
		const negated = line.startsWith("!");
		const pattern = (negated ? line.slice(1) : line).trim();
		if (matchesCandidate(pattern, basename)) covered = !negated;
	}
	return covered;
}

function matchesCandidate(pattern: string, basename: string): boolean {
	if (pattern === "" || pattern.endsWith("/")) return false;
	const unanchored = pattern.startsWith("/") ? pattern.slice(1) : pattern;
	if (unanchored === "") return false;
	if (GLOB_META.test(unanchored)) {
		const direct = picomatch(unanchored, { dot: true });
		if (direct(basename)) return true;
		return picomatch(`**/${unanchored}`, { dot: true })(basename);
	}
	return unanchored === basename;
}
