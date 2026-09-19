import { Node, SyntaxKind } from "../../engine/parser/types.js";
import { defineRule } from "../../engine/registry.js";
import { isInsideFunctionLike } from "./async-calls.js";

/**
 * Flags `JSON.parse(…)` inside function bodies with no ancestor try/catch —
 * a malformed payload throws at request time. Module top level is exempt
 * (init-time crash-fast on trusted local config is idiomatic; spec 005, open
 * question 3) and a finally-only try does not guard (design decision 8).
 */
export const unhandledJsonParse = defineRule({
	id: "backend-doctor/unhandled-json-parse",
	title: "Unhandled JSON.parse",
	category: "Bugs",
	severity: "warn",
	docs: "docs/rules/backend-doctor/unhandled-json-parse.md",
	create(ctx) {
		ctx.file.forEachDescendant((node) => {
			const call = node.asKind(SyntaxKind.CallExpression);
			if (!call) return undefined;
			const callee = call.getExpression();
			if (
				!Node.isPropertyAccessExpression(callee) ||
				callee.getName() !== "parse" ||
				callee.getExpression().getText() !== "JSON"
			) {
				return undefined;
			}
			if (!isInsideFunctionLike(call)) return undefined;
			if (isGuardedByTryCatch(call)) return undefined;
			ctx.report({
				node: call,
				message:
					"JSON.parse throws on malformed input and this call is not guarded by try/catch; a bad payload will crash this code path. Guard it or validate the input first.",
			});
			return undefined;
		});
	},
});

function isGuardedByTryCatch(call: Node): boolean {
	let current: Node | undefined = call.getParent();
	while (current) {
		if (Node.isTryStatement(current) && current.getCatchClause()) return true;
		current = current.getParent();
	}
	return false;
}
