import { defineRule } from "../../engine/registry.js";
import { findStatementLevelAsyncCalls } from "./async-calls.js";

/**
 * Flags async work started directly inside constructors (spec 005, open
 * question 4: constructor bodies are owned exclusively by this rule —
 * `no-floating-promises` skips them, so one violation yields one diagnostic).
 */
export const noAsyncConstructorWork = defineRule({
	id: "backend-doctor/no-async-constructor-work",
	title: "No async constructor work",
	category: "Correctness",
	severity: "warn",
	docs: "docs/rules/backend-doctor/no-async-constructor-work.md",
	create(ctx) {
		for (const candidate of findStatementLevelAsyncCalls(ctx.file)) {
			if (!candidate.inConstructor) continue;
			ctx.report({
				node: candidate.call,
				message:
					"Constructor starts async work without awaiting it; initialization races with first use. Move the work into an explicit init method that callers can await.",
			});
		}
	},
});
