/**
 * Partial scan scopes (spec 015). `"all"` — the pre-F015 full scan — is the
 * CLI default and never reaches the engine as a scope object; the report
 * spells it `mode: "full"`.
 */
export type ScopeMode = "changed" | "files" | "lines";

export type ScopeOption = "all" | ScopeMode;

/** 1-based, inclusive line span of a `-U0` diff hunk's new side. */
export interface LineRange {
	start: number;
	end: number;
}

/**
 * A resolved scope ready for the engine: the absolute file paths allowed
 * through, and — for `lines` scope only — the changed hunk ranges per
 * absolute path. A tracked changed file always has an entry (possibly empty:
 * nothing changed line-wise); an untracked file has none (whole file
 * counts as changed).
 */
export interface ResolvedScope {
	mode: ScopeMode;
	files: ReadonlySet<string>;
	lineRanges: ReadonlyMap<string, readonly LineRange[]>;
	/**
	 * The resolved `--base` value; present only for `changed`/`lines`, where
	 * the report's `scope.base` field carries it for reproducibility.
	 */
	base?: string;
}
