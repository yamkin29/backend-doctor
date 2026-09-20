import {
	type Expression,
	Node,
	SyntaxKind,
} from "../../engine/parser/types.js";

/**
 * Request-input heuristic (spec 007): request data is approximated by
 * property chains rooted at the exact identifiers `req`/`request` — the
 * near-universal Express/Nest handler parameter naming. Matched directly,
 * through parentheses, in template substitutions, or as `+` operands.
 * Deliberately NOT matched (documented recall holes in the consuming rules'
 * docs): `req` passed whole, element access (`req["params"]`), call results
 * over request values (`req.file.name.trim()`), other root names.
 */
const REQUEST_ROOTS = new Set(["req", "request"]);

export function containsRequestInput(expression: Expression): boolean {
	const expr = unwrapParens(expression);
	if (isRequestRootedChain(expr)) return true;
	if (Node.isTemplateExpression(expr)) {
		// ts-morph v28: the method is getTemplateSpans (getSpans does not exist).
		return expr
			.getTemplateSpans()
			.some((span) => containsRequestInput(span.getExpression()));
	}
	if (Node.isBinaryExpression(expr)) {
		if (expr.getOperatorToken().getKind() !== SyntaxKind.PlusToken) {
			return false;
		}
		return (
			containsRequestInput(expr.getLeft()) ||
			containsRequestInput(expr.getRight())
		);
	}
	return false;
}

function isRequestRootedChain(expr: Expression): boolean {
	const access = expr.asKind(SyntaxKind.PropertyAccessExpression);
	if (!access) return false;
	const base = unwrapParens(access.getExpression());
	if (Node.isIdentifier(base)) return REQUEST_ROOTS.has(base.getText());
	return isRequestRootedChain(base);
}

function unwrapParens(expression: Expression): Expression {
	let expr = expression;
	while (Node.isParenthesizedExpression(expr)) {
		expr = expr.getExpression();
	}
	return expr;
}
