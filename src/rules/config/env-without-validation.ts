import type { Node, SourceFileView } from "../../engine/parser/types.js";
import { defineProjectRule } from "../../engine/registry.js";
import { collectEnvAccesses } from "./env-usage.js";

/**
 * Pinned validation libraries (spec 014 resolution 3): a module specifier
 * equal to the name or under a `name/…` subpath counts. `@nestjs/config`
 * is deliberately absent — ConfigModule does not validate without a
 * schema, and the schema library itself is what gets imported.
 */
const VALIDATION_LIBRARIES = [
	"zod",
	"class-validator",
	"joi",
	"envalid",
	"convict",
	"env-schema",
];

function importsValidationLibrary(specifiers: readonly string[]): boolean {
	return specifiers.some((specifier) =>
		VALIDATION_LIBRARIES.some(
			(name) => specifier === name || specifier.startsWith(`${name}/`),
		),
	);
}

/**
 * One diagnostic per scan when the analyzed set reads the environment but
 * no analyzed file imports a validation library (spec 014 AC-2). The
 * project-scope check keeps cross-file schemas from flagging honest
 * config files — any pinned import anywhere silences the rule, and
 * hand-rolled validation stays flagged (documented FP risk, F022 gates).
 * The census deliberately ignores the config/test path exemptions: reads
 * in config files are exactly the reads that must be validated.
 */
export const envWithoutValidation = defineProjectRule({
	id: "backend-doctor/env-without-validation",
	title: "Environment without validation",
	category: "Configuration",
	severity: "warn",
	docs: "docs/rules/backend-doctor/env-without-validation.md",
	analyze(project) {
		let first: { file: SourceFileView; node: Node } | undefined;
		let count = 0;
		for (const view of project.files) {
			if (importsValidationLibrary(view.getModuleSpecifiers())) return;
			const accesses = collectEnvAccesses(view);
			const firstAccess = accesses[0];
			if (!firstAccess) continue;
			first ??= { file: view, node: firstAccess };
			count += accesses.length;
		}
		if (!first) return;
		const position = project.positionOf(first.file, first.node);
		project.report({
			filePath: first.file.filePath,
			line: position.line,
			column: position.column,
			message: `Environment variables are read in ${count} place(s) but never validated; a missing or misspelled variable surfaces as a runtime failure. Parse the whole environment with a schema (zod, class-validator, envalid) in your config module.`,
		});
	},
});
