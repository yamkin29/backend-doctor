import { defineRule } from "../../engine/registry.js";
import { findProviderCycles } from "./di-graph.js";

/**
 * Reports one diagnostic per provider dependency cycle at the cycle's
 * canonical member (spec 009 AC-8). Cycles that already carry forwardRef
 * work at bootstrap but stay an architecture smell; cycles without it are
 * additionally flagged by missing-forward-ref.
 */
export const circularDi = defineRule({
	id: "backend-doctor/circular-di",
	title: "Circular dependency",
	category: "Architecture",
	severity: "warn",
	docs: "docs/rules/backend-doctor/circular-di.md",
	frameworks: ["nest"],
	create(ctx) {
		const model = ctx.nest;
		if (!model) return;
		for (const cycle of findProviderCycles(model)) {
			const canonical = cycle.path[0];
			if (!canonical || canonical.filePath !== ctx.file.filePath) continue;
			ctx.report({
				line: canonical.line,
				column: canonical.column,
				message: `Providers form a circular dependency: ${cycle.pathText}. Restructure so dependencies flow one way (extract a shared third provider); a truly mutual pair needs forwardRef() on both sides.`,
			});
		}
	},
});
