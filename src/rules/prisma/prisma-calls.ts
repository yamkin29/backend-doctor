import {
	type CallExpression,
	type Expression,
	Node,
	SyntaxKind,
} from "../../engine/parser/types.js";
import { isFunctionLike } from "../async/async-calls.js";

/**
 * Shared vocabulary and AST walks for the Prisma pack (spec 012, design
 * §1). Method names are Prisma-specific on purpose: the framework gate
 * activates the pack, and these names are distinctive enough that other
 * libraries' methods never enter the candidate sets (design decision 2).
 */

/** Read queries: the per-iteration round-trips `no-prisma-n-plus-one` flags. */
export const PRISMA_READ_QUERIES = [
	"findMany",
	"findFirst",
	"findUnique",
	"findFirstOrThrow",
	"findUniqueOrThrow",
	"count",
	"aggregate",
	"groupBy",
] as const;

/** Raw-query APIs whose string form `no-unsafe-raw-query` inspects. */
export const PRISMA_RAW_QUERIES = [
	"$queryRaw",
	"$executeRaw",
	"$queryRawUnsafe",
	"$executeRawUnsafe",
] as const;

const LOOP_KINDS: readonly SyntaxKind[] = [
	SyntaxKind.ForStatement,
	SyntaxKind.ForOfStatement,
	SyntaxKind.ForInStatement,
	SyntaxKind.WhileStatement,
	SyntaxKind.DoStatement,
];

export function unwrapParens(expression: Expression): Expression {
	let expr = expression;
	while (Node.isParenthesizedExpression(expr)) {
		expr = expr.getExpression();
	}
	return expr;
}

/**
 * True when the call's expression is consumed by an await: an unawaited
 * query in a loop is the floating-promise pack's finding (F005), so the
 * await requirement partitions the two rules (spec 012, design decision 3).
 */
export function isAwaitedCall(call: CallExpression): boolean {
	let parent = call.getParent();
	while (parent && Node.isParenthesizedExpression(parent)) {
		parent = parent.getParent();
	}
	return parent !== undefined && Node.isAwaitExpression(parent);
}

/**
 * True when a function-like boundary-free ancestor chain from the call
 * crosses one of the five loop kinds: the call sits directly in the loop
 * body. Calls inside nested functions are out — the nearest-function-like
 * rule decides (the `yieldsLoop` design decision 7 precedent). The list
 * deliberately differs from F006's collector: `for…of`/`for…in` are the
 * dominant N+1 idioms, while sync-blocking loops were not.
 */
export function isInsideLoop(call: CallExpression): boolean {
	let current: Node | undefined = call;
	while (current) {
		if (isFunctionLike(current)) return false;
		if (LOOP_KINDS.includes(current.getKind())) return true;
		current = current.getParent();
	}
	return false;
}

/**
 * True when the node sits anywhere inside the container's subtree. Unlike
 * `isInsideLoop` this does NOT stop at function boundaries: a timer inside a
 * `new Promise` executor inside a transaction callback still delays the
 * transaction (spec 012, design decision 6).
 */
export function isInsideNode(node: Node, container: Node): boolean {
	let current: Node | undefined = node;
	while (current) {
		if (current === container) return true;
		current = current.getParent();
	}
	return false;
}

/**
 * True when the receiver chain of the call is rooted at the identifier
 * `root` (the `isRequestRootedChain` walk, spec 007 symmetry): unwraps
 * parens, then member accesses, down to the base identifier.
 */
export function isRootedAt(call: CallExpression, root: string): boolean {
	const callee = unwrapParens(call.getExpression());
	if (!Node.isPropertyAccessExpression(callee)) return false;
	let base: Expression = callee.getExpression();
	while (Node.isPropertyAccessExpression(base)) {
		base = base.getExpression();
	}
	return Node.isIdentifier(base) && base.getText() === root;
}
