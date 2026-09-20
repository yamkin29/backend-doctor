/**
 * Path-shape predicates for the config/env pack (spec 014 design §2).
 * Both take the target-relative posix path of an analyzed file and decide
 * whether the file is exempt from the "no direct process.env" scope:
 * config-shaped files are where env reads belong; test-shaped files are
 * exempt per spec resolution 2 (env setup in tests is idiomatic).
 */

/** Directory segments (exact, lowercased) that mark a config module. */
const CONFIG_DIRECTORY_SEGMENTS = new Set([
	"config",
	"configs",
	"configuration",
	"configurations",
	"env",
	"environments",
	"settings",
]);

/** Basename tokens (substring, lowercased) that mark a config module. */
const CONFIG_BASENAME_TOKENS = ["config", "env", "settings"];

/** Directory segments (exact, lowercased) that mark test code. */
const TEST_DIRECTORY_SEGMENTS = new Set(["test", "tests", "__tests__", "e2e"]);

export function isConfigShapedPath(relativePath: string): boolean {
	const segments = relativePath.toLowerCase().split("/");
	const basename = segments[segments.length - 1] ?? "";
	if (segments.slice(0, -1).some((s) => CONFIG_DIRECTORY_SEGMENTS.has(s))) {
		return true;
	}
	const stem = basename.replace(/\.[^.]*$/, "");
	return CONFIG_BASENAME_TOKENS.some((token) => stem.includes(token));
}

export function isTestShapedPath(relativePath: string): boolean {
	const segments = relativePath.toLowerCase().split("/");
	const basename = segments[segments.length - 1] ?? "";
	if (segments.slice(0, -1).some((s) => TEST_DIRECTORY_SEGMENTS.has(s))) {
		return true;
	}
	const stem = basename.replace(/\.[^.]*$/, "");
	return stem.endsWith(".test") || stem.endsWith(".spec");
}
