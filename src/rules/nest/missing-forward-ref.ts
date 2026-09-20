import { defineRule } from "../../engine/registry.js";
import { findProviderCycles } from "./di-graph.js";

/**
 * Reports injection cycles in which no edge uses forwardRef() — Nest cannot
 * construct these providers and the app fails at bootstrap (spec 009 AC-9).
 * The diagnostic sits on the parameter that closes the cycle: that is the
 * injection to wrap. Cycles that already use forwardRef stay silent here and
 * are reported by circular-di instead.
 */
export const missingForwardRef = defineRule({
	id: "backend-doctor/missing-forward-ref",
	title: "Missing forwardRef",
	category: "Correctness",
	severity: "warn",
	docs: "docs/rules/backend-doctor/missing-forward-ref.md",
	frameworks: ["nest"],
	create(ctx) {
		const model = ctx.nest;
		if (!model) return;
		for (const cycle of findProviderCycles(model)) {
			if (cycle.hasForwardRef) continue;
			if (cycle.closingConsumer.filePath !== ctx.file.filePath) continue;
			ctx.report({
				line: cycle.closingEdge.line,
				column: cycle.closingEdge.column,
				message: `The injection cycle ${cycle.pathText} uses no forwardRef(), so Nest cannot construct these providers and fails at bootstrap with a circular-dependency error. Wrap the type in forwardRef(() => X) on both sides or restructure.`,
			});
		}
	},
});
