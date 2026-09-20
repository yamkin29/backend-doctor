import { Node } from "../../engine/parser/types.js";
import { defineRule } from "../../engine/registry.js";
import { findModuleApiCalls } from "../shared/module-api-calls.js";
import {
	isAwaitedCall,
	isInsideLoop,
	PRISMA_READ_QUERIES,
	unwrapParens,
} from "./prisma-calls.js";

/**
 * Flags a Prisma read query awaited directly inside a loop body — one
 * database round-trip per iteration (spec 012 AC-1). The query must be
 * awaited: an unawaited call in a loop is already the floating-promise
 * pack's finding, so the two rules partition instead of double-firing.
 * Nested functions inside the loop (Promise.all fan-outs) are out of
 * scope; own-class members and shadowed bare identifiers stay silent via
 * the `findModuleApiCalls` protections.
 */
export const noPrismaNPlusOne = defineRule({
	id: "backend-doctor/no-prisma-n-plus-one",
	title: "No Prisma N+1 queries in loops",
	category: "Performance",
	severity: "warn",
	docs: "docs/rules/backend-doctor/no-prisma-n-plus-one.md",
	frameworks: ["prisma"],
	create(ctx) {
		const candidates = findModuleApiCalls(ctx.file, {
			names: PRISMA_READ_QUERIES,
			accept: (call) =>
				Node.isPropertyAccessExpression(unwrapParens(call.getExpression())),
		});
		for (const { call } of candidates) {
			if (!isAwaitedCall(call) || !isInsideLoop(call)) continue;
			ctx.report({
				node: call,
				message:
					"This Prisma query runs once per loop iteration (N+1): every pass makes another database round-trip. Fetch everything in one query instead — load relations with include/select, or batch the ids with findMany({ where: { id: { in: ids } } }).",
			});
		}
	},
});
