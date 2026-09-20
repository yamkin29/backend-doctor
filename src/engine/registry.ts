import type { DiagnosticCategory, Severity } from "../core/types.js";
import type { RuleContext } from "./parser/types.js";
import type { ProjectRuleContext } from "./project-rules.js";

/**
 * A self-contained rule: identity, classification and a `create` body that
 * traverses the file via the adapter's view and reports findings
 * (spec 003, rules and diagnostics).
 */
export interface RuleDefinition {
	/** Stable kebab-case id with the `backend-doctor/` prefix. */
	readonly id: string;
	readonly title: string;
	readonly category: DiagnosticCategory;
	/** Default severity (constitution §2: new rules start as "warn"). */
	readonly severity: Severity;
	/** Path of the rule doc under docs/rules/. */
	readonly docs: string;
	/**
	 * Frameworks (ids from src/framework) the rule requires. The runner runs
	 * the rule only when every listed framework is detected; absent or empty
	 * means unconditional (spec 004, pack gate).
	 */
	readonly frameworks?: readonly string[];
	create(ctx: RuleContext): void;
}

/** Identity helper giving rule definitions full type checking. */
export function defineRule(definition: RuleDefinition): RuleDefinition {
	return definition;
}

const registered: RuleDefinition[] = [];
const registeredIds = new Set<string>();

export function registerRule(rule: RuleDefinition): void {
	if (registeredIds.has(rule.id)) {
		throw new Error(`Rule "${rule.id}" is already registered`);
	}
	registeredIds.add(rule.id);
	registered.push(rule);
}

export function allRules(): readonly RuleDefinition[] {
	return registered;
}

/** Test hygiene helper: empties the registry. */
export function clearRegisteredRules(): void {
	registered.length = 0;
	registeredIds.clear();
	registeredProject.length = 0;
	registeredProjectIds.clear();
}

/**
 * A project rule (spec 013): the second rule kind, per the react-doctor
 * `create`/`scan` precedent. Identity and gates match `RuleDefinition`;
 * the body runs once per scan over the whole analyzed file set instead of
 * once per file.
 */
export interface ProjectRuleDefinition {
	/** Stable kebab-case id with the `backend-doctor/` prefix. */
	readonly id: string;
	readonly title: string;
	readonly category: DiagnosticCategory;
	/** Default severity (constitution §2: new rules start as "warn"). */
	readonly severity: Severity;
	/** Path of the rule doc under docs/rules/. */
	readonly docs: string;
	/**
	 * Frameworks (ids from src/framework) the rule requires. The runner runs
	 * the rule only when every listed framework is detected; absent or empty
	 * means unconditional (spec 004, pack gate).
	 */
	readonly frameworks?: readonly string[];
	analyze(project: ProjectRuleContext): void;
}

/** Identity helper giving project rule definitions full type checking. */
export function defineProjectRule(
	definition: ProjectRuleDefinition,
): ProjectRuleDefinition {
	return definition;
}

const registeredProject: ProjectRuleDefinition[] = [];
const registeredProjectIds = new Set<string>();

export function registerProjectRule(rule: ProjectRuleDefinition): void {
	if (registeredProjectIds.has(rule.id)) {
		throw new Error(`Rule "${rule.id}" is already registered`);
	}
	registeredProjectIds.add(rule.id);
	registeredProject.push(rule);
}

export function allProjectRules(): readonly ProjectRuleDefinition[] {
	return registeredProject;
}
