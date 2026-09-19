import { Node, SyntaxKind } from "../../engine/parser/types.js";
import { defineRule } from "../../engine/registry.js";

/**
 * Flags `X.forEach(async …)` — the promise returned by an async callback is
 * neither awaited nor does it order the iteration. Any receiver matches (no
 * type info); identifier-referenced callbacks are a documented recall hole
 * (spec 005, contract).
 */
export const noAsyncForeachCallback = defineRule({
	id: "backend-doctor/no-async-foreach-callback",
	title: "No async forEach callback",
	category: "Bugs",
	severity: "warn",
	docs: "docs/rules/backend-doctor/no-async-foreach-callback.md",
	create(ctx) {
		ctx.file.forEachDescendant((node) => {
			const call = node.asKind(SyntaxKind.CallExpression);
			if (!call) return undefined;
			const callee = call.getExpression();
			if (
				!Node.isPropertyAccessExpression(callee) ||
				callee.getName() !== "forEach"
			) {
				return undefined;
			}
			const callback = call.getArguments()[0];
			const fn =
				callback?.asKind(SyntaxKind.ArrowFunction) ??
				callback?.asKind(SyntaxKind.FunctionExpression);
			if (fn?.isAsync()) {
				ctx.report({
					node: call,
					message:
						"Array.forEach does not await async callbacks, so iteration order is lost and rejections go unhandled. Use for…of with await or Promise.all(items.map(...)).",
				});
			}
			return undefined;
		});
	},
});
