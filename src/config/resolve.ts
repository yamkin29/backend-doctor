import type { ResolvedConfig } from "./types.js";

export interface CliOverrides {
	/** Globs passed via repeated --ignore flags. */
	ignoreGlobs: string[];
}

/**
 * Applies CLI overrides on top of a resolved config. List flags are additive:
 * CLI ignore globs are unioned with config ignore.files (deduplicated, config
 * entries first). Scalars would override; there are none in F002.
 */
export function resolveCliOverrides(
	config: ResolvedConfig,
	overrides: CliOverrides,
): ResolvedConfig {
	const seen = new Set<string>();
	const files: string[] = [];
	for (const glob of [...config.ignore.files, ...overrides.ignoreGlobs]) {
		if (!seen.has(glob)) {
			seen.add(glob);
			files.push(glob);
		}
	}
	return { ...config, ignore: { ...config.ignore, files } };
}
