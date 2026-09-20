import { defineRule } from "../../engine/registry.js";

/** Deliberately above the folk "5 collaborators" line: warn, not nitpick. */
const MAX_DEPENDENCIES = 6;
const MAX_PUBLIC_METHODS = 12;

/**
 * Flags providers that accumulated too many responsibilities, measured by
 * the two cheap proxies the model carries: constructor dependencies (≥ 6)
 * and public instance methods (≥ 12; lifecycle hooks excluded, spec 010
 * AC-6). One diagnostic per provider, at the class position, with both
 * actual counts in the message.
 */
export const noGodService = defineRule({
	id: "backend-doctor/no-god-service",
	title: "God service",
	category: "Maintainability",
	severity: "warn",
	docs: "docs/rules/backend-doctor/no-god-service.md",
	frameworks: ["nest"],
	create(ctx) {
		const model = ctx.nest;
		if (!model) return;
		for (const provider of model.providers) {
			if (provider.filePath !== ctx.file.filePath) continue;
			const dependencies = provider.injections.length;
			const methods = provider.publicMethods.length;
			if (dependencies < MAX_DEPENDENCIES && methods < MAX_PUBLIC_METHODS) {
				continue;
			}
			ctx.report({
				line: provider.line,
				column: provider.column,
				message: `${provider.className} carries ${dependencies} constructor dependencies and ${methods} public methods; that breadth is a god-service smell. Split it along domain responsibilities into smaller providers.`,
			});
		}
	},
});
