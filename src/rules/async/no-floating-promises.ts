import { defineRule } from "../../engine/registry.js";
import { findStatementLevelAsyncCalls } from "./async-calls.js";

/**
 * Flags statement-level calls to same-file async functions, async class
 * methods via `this`, and unshadowed `fetch` — the heuristic (non-type-aware)
 * floating-promise scope fixed by spec 005, open question 1. Constructor
 * bodies are owned by `no-async-constructor-work` (open question 4) and are
 * skipped here.
 */
export const noFloatingPromises = defineRule({
	id: "backend-doctor/no-floating-promises",
	title: "No floating promises",
	category: "Correctness",
	severity: "warn",
	docs: "docs/rules/backend-doctor/no-floating-promises.md",
	create(ctx) {
		for (const candidate of findStatementLevelAsyncCalls(ctx.file)) {
			if (candidate.inConstructor) continue;
			ctx.report({
				node: candidate.call,
				message:
					"This call returns a promise that is neither awaited nor handled; its rejection is silently lost. Add await, a .catch handler, or the void operator if fire-and-forget is intended.",
			});
		}
	},
});
