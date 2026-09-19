import {
	type Expression,
	Node,
	SyntaxKind,
} from "../../engine/parser/types.js";
import { defineRule } from "../../engine/registry.js";

/**
 * Flags eval() in its direct, comma-indirect `(0, eval)` and
 * `globalThis.eval` forms. Aliased eval (`const e = eval`) is out of scope —
 * see docs/rules/backend-doctor/no-eval.md.
 */
export const noEval = defineRule({
	id: "backend-doctor/no-eval",
	title: "No eval",
	category: "Security",
	severity: "warn",
	docs: "docs/rules/backend-doctor/no-eval.md",
	create(ctx) {
		ctx.file.forEachDescendant((node) => {
			const call = node.asKind(SyntaxKind.CallExpression);
			if (call && isEvalExpression(call.getExpression())) {
				ctx.report({
					node,
					message:
						"Prefer safer alternatives instead of eval(); it executes arbitrary code.",
				});
			}
			return undefined;
		});
	},
});

function isEvalExpression(expression: Expression): boolean {
	const expr = unwrapParens(expression);
	if (Node.isIdentifier(expr)) {
		return expr.getText() === "eval";
	}
	// Indirect form: (0, eval)(…) — a comma expression ending in `eval`.
	if (Node.isBinaryExpression(expr)) {
		return (
			expr.getOperatorToken().getKind() === SyntaxKind.CommaToken &&
			expr.getRight().getText() === "eval"
		);
	}
	// globalThis.eval(…)
	if (Node.isPropertyAccessExpression(expr)) {
		return (
			expr.getExpression().getText() === "globalThis" &&
			expr.getName() === "eval"
		);
	}
	return false;
}

function unwrapParens(expression: Expression): Expression {
	let expr = expression;
	while (Node.isParenthesizedExpression(expr)) {
		expr = expr.getExpression();
	}
	return expr;
}
