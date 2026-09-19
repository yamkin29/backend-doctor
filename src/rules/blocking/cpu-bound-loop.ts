import { Node, SyntaxKind } from "../../engine/parser/types.js";
import { defineRule } from "../../engine/registry.js";
import { isInsideFunctionLike } from "../async/async-calls.js";
import { collectLoopsAndAwaits, loopCondition, yieldsLoop } from "./loops.js";

/**
 * Numeric literal bounds below this are considered normal iteration and
 * never flagged (spec 006 open question 2).
 */
const BOUND_THRESHOLD = 10_000;

const COMPARISON_KINDS: readonly SyntaxKind[] = [
	SyntaxKind.LessThanToken,
	SyntaxKind.GreaterThanToken,
	SyntaxKind.LessThanEqualsToken,
	SyntaxKind.GreaterThanEqualsToken,
];

/**
 * Flags loops bounded by a large numeric literal (≥ 10,000) whose body never
 * awaits — the one loop shape provably blocking for at least `bound`
 * iterations statically (spec 006 open question 1). Variable and computed
 * bounds are undetectable without types; `while (true)` needs reachability
 * analysis — both documented recall holes. Loops at module top level are
 * exempt, like the rest of the pack.
 */
export const noCpuBoundLoop = defineRule({
	id: "backend-doctor/no-cpu-bound-loop",
	title: "No CPU-bound loop",
	category: "Performance",
	severity: "warn",
	docs: "docs/rules/backend-doctor/no-cpu-bound-loop.md",
	create(ctx) {
		const { loops, awaits } = collectLoopsAndAwaits(ctx.file);
		for (const loop of loops) {
			if (!isInsideFunctionLike(loop)) continue;
			if (!isLiteralBounded(loop)) continue;
			if (yieldsLoop(loop, awaits)) continue;
			ctx.report({
				node: loop,
				message:
					"This loop runs a literal-bounded body of at least 10,000 iterations without awaiting, so it blocks the event loop for the whole run. Move heavy CPU work off the request path or chunk it with setImmediate.",
			});
		}
	},
});

/** True when the loop condition compares against a numeric literal ≥ threshold. */
function isLiteralBounded(loop: Node): boolean {
	const condition = loopCondition(loop);
	if (!condition) return false;
	if (!Node.isBinaryExpression(condition)) return false;
	if (!COMPARISON_KINDS.includes(condition.getOperatorToken().getKind())) {
		return false;
	}
	const bound =
		numericValue(condition.getLeft()) ?? numericValue(condition.getRight());
	return bound !== null && bound >= BOUND_THRESHOLD;
}

/** Numeric literal value with `_` separators normalized, or null. */
function numericValue(node: Node): number | null {
	const literal = node.asKind(SyntaxKind.NumericLiteral);
	if (!literal) return null;
	const value = Number(literal.getText().replace(/_/g, ""));
	return Number.isFinite(value) ? value : null;
}
