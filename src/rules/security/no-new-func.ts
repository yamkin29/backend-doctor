import { Node, SyntaxKind } from "../../engine/parser/types.js";
import { defineRule } from "../../engine/registry.js";

/** Flags `new Function(…)` — the lazily-parsed sibling of eval(). */
export const noNewFunc = defineRule({
	id: "backend-doctor/no-new-func",
	title: "No new Function",
	category: "Security",
	severity: "warn",
	docs: "docs/rules/backend-doctor/no-new-func.md",
	create(ctx) {
		ctx.file.forEachDescendant((node) => {
			const newExpression = node.asKind(SyntaxKind.NewExpression);
			const callee = newExpression?.getExpression();
			if (
				callee &&
				Node.isIdentifier(callee) &&
				callee.getText() === "Function"
			) {
				ctx.report({
					node,
					message:
						"Prefer explicit code instead of new Function(); it compiles arbitrary code at runtime.",
				});
			}
			return undefined;
		});
	},
});
