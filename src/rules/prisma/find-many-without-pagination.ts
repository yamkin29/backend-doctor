import { type CallExpression, Node } from "../../engine/parser/types.js";
import { defineRule } from "../../engine/registry.js";
import { findModuleApiCalls } from "../shared/module-api-calls.js";
import { unwrapParens } from "./prisma-calls.js";

/**
 * Flags unbounded `findMany` calls (spec 012 AC-3): no argument at all, or
 * an object-literal argument without `take`. A non-object argument
 * (variable, spread) is unknown provenance and stays silent — the rule
 * reports only provably unbounded result sets. `findFirst`/`findUnique`
 * are single-row by design and never match. Nested `include` shapes are
 * out of scope: only the call's own result set is bounded here.
 */
export const findManyWithoutPagination = defineRule({
	id: "backend-doctor/find-many-without-pagination",
	title: "findMany without pagination",
	category: "Performance",
	severity: "warn",
	docs: "docs/rules/backend-doctor/find-many-without-pagination.md",
	frameworks: ["prisma"],
	create(ctx) {
		const candidates = findModuleApiCalls(ctx.file, {
			names: ["findMany"],
			accept: (call) =>
				Node.isPropertyAccessExpression(unwrapParens(call.getExpression())) &&
				lacksTake(call),
		});
		for (const { call } of candidates) {
			ctx.report({
				node: call,
				message:
					"findMany without take loads every matching row into memory; bound the result set with take (and skip or cursor for paging).",
			});
		}
	},
});

function lacksTake(call: CallExpression): boolean {
	const argument = call.getArguments()[0];
	if (argument === undefined) return true;
	if (Node.isSpreadElement(argument)) return false;
	if (!Node.isObjectLiteralExpression(argument)) return false;
	return !argument
		.getProperties()
		.some(
			(property) =>
				(Node.isPropertyAssignment(property) ||
					Node.isShorthandPropertyAssignment(property)) &&
				property.getName() === "take",
		);
}
