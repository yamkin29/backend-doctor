import type { ResolvedConfig, SeverityOverride } from "../config/types.js";
import type { DiagnosticCategory, Severity } from "../core/types.js";

export interface SeverityResolution {
	ruleId: string;
	category: DiagnosticCategory;
	/** Severity shipped with the rule definition. */
	default: Severity;
	config: ResolvedConfig;
}

/**
 * Severity resolution matrix (spec 003 AC-5):
 * `config.rules[id]` > `config.categories[category]` > rule default.
 * The `ignore.rules` disable path is a runner concern, not a severity.
 */
export function resolveSeverity(input: SeverityResolution): SeverityOverride {
	const fromRule = input.config.rules[input.ruleId];
	if (fromRule) return fromRule;
	const fromCategory = input.config.categories[input.category];
	if (fromCategory) return fromCategory;
	return input.default;
}
