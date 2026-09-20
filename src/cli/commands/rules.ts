import process from "node:process";
import { allProjectRules, allRules } from "../../engine/registry.js";
// Importing registers the product rules so the command sees the full set.
import "../../rules/index.js";

/**
 * Structural view of the metadata both rule kinds carry. `RuleDefinition`
 * and `ProjectRuleDefinition` satisfy it; tests can hand-roll plain objects.
 */
export interface RuleMeta {
	readonly id: string;
	readonly title: string;
	readonly category: string;
	readonly severity: string;
	readonly docs: string;
	readonly frameworks?: readonly string[];
}

export type RuleKind = "file" | "project";

function gateLabel(rule: RuleMeta): string {
	if (rule.frameworks === undefined || rule.frameworks.length === 0) {
		return "-";
	}
	return rule.frameworks.join(", ");
}

/**
 * Spec 017 AC-1/AC-2: one line per rule in the given (registration) order —
 * id, category, default severity, framework gate — with a header and a final
 * count line. A pure function of its arguments, so output is byte-stable.
 */
export function formatRulesList(
	fileRules: readonly RuleMeta[],
	projectRules: readonly RuleMeta[],
): string {
	const rows = [...fileRules, ...projectRules];
	const idWidth = Math.max(
		"RULE ID".length,
		...rows.map((rule) => rule.id.length),
	);
	const categoryWidth = Math.max(
		"CATEGORY".length,
		...rows.map((rule) => rule.category.length),
	);
	const severityWidth = Math.max(
		"SEVERITY".length,
		...rows.map((rule) => rule.severity.length),
	);
	const header = [
		"RULE ID".padEnd(idWidth),
		"CATEGORY".padEnd(categoryWidth),
		"SEVERITY".padEnd(severityWidth),
		"GATE",
	].join("  ");
	const lines = rows.map((rule) =>
		[
			rule.id.padEnd(idWidth),
			rule.category.padEnd(categoryWidth),
			rule.severity.padEnd(severityWidth),
			gateLabel(rule),
		].join("  "),
	);
	return `${[header, ...lines, "", `${rows.length} rules`].join("\n")}\n`;
}

/** Spec 017 AC-3: full metadata view of one rule. */
export function formatRuleExplain(rule: RuleMeta, kind: RuleKind): string {
	const kindLabel =
		kind === "file"
			? "file rule (runs once per analyzed file)"
			: "project rule (runs once per scan over the whole file set)";
	const gate =
		rule.frameworks === undefined || rule.frameworks.length === 0
			? "none — runs unconditionally"
			: `${rule.frameworks.join(", ")} — runs only when all are detected`;
	return `${[
		rule.id,
		`  Title: ${rule.title}`,
		`  Category: ${rule.category}`,
		`  Default severity: ${rule.severity}`,
		`  Kind: ${kindLabel}`,
		`  Framework gate: ${gate}`,
		`  Config key: rules["${rule.id}"] — off | warn | error`,
		`  Docs: ${rule.docs}`,
	].join("\n")}\n`;
}

/** `backend-doctor rules list` — a pure view of the registry, always exit 0. */
export function rulesListCommand(): number {
	process.stdout.write(formatRulesList(allRules(), allProjectRules()));
	return 0;
}

/**
 * `backend-doctor rules explain <id>` — full ids only (no bare alias); an
 * unregistered id is a usage error: exit 2, id on stderr, nothing on stdout.
 */
export function rulesExplainCommand(id: string): number {
	const fileRule = allRules().find((rule) => rule.id === id);
	if (fileRule !== undefined) {
		process.stdout.write(formatRuleExplain(fileRule, "file"));
		return 0;
	}
	const projectRule = allProjectRules().find((rule) => rule.id === id);
	if (projectRule !== undefined) {
		process.stdout.write(formatRuleExplain(projectRule, "project"));
		return 0;
	}
	process.stderr.write(`Unknown rule id: ${id}\n`);
	process.stderr.write(
		`Run "backend-doctor rules list" to see registered ids.\n`,
	);
	return 2;
}
