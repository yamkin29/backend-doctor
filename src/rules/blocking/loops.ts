import {
	type Expression,
	type Node,
	type SourceFileView,
	SyntaxKind,
} from "../../engine/parser/types.js";
import { isFunctionLike } from "../async/async-calls.js";

/**
 * Loop/await sweep helpers for `no-cpu-bound-loop` (spec 006, design §1).
 * A single file traversal collects both node kinds; the rule then joins
 * them.
 */

/**
 * True when an await expression's boundary-free ancestor chain contains the
 * loop: the await executes in the loop's own scope and yields the loop each
 * iteration (design decision 7). Awaits inside nested async callbacks do
 * not count — the callback runs concurrently while the loop still blocks.
 */
export function yieldsLoop(loop: Node, awaits: readonly Node[]): boolean {
	for (const awaitNode of awaits) {
		let current: Node | undefined = awaitNode.getParent();
		while (current) {
			if (current === loop) return true;
			if (isFunctionLike(current)) break;
			current = current.getParent();
		}
	}
	return false;
}

/**
 * The loop's condition expression, or undefined when absent (`for(;;)`) or
 * when the node is not one of the three loop kinds. ts-morph v28 quirk:
 * `while`/`do…while` expose their condition via the ExpressionedNode mixin
 * (`getExpression()`); only `for` has `getCondition()`.
 */
export function loopCondition(node: Node): Expression | undefined {
	const forLoop = node.asKind(SyntaxKind.ForStatement);
	if (forLoop) return forLoop.getCondition();
	const whileLoop = node.asKind(SyntaxKind.WhileStatement);
	if (whileLoop) return whileLoop.getExpression();
	const doLoop = node.asKind(SyntaxKind.DoStatement);
	if (doLoop) return doLoop.getExpression();
	return undefined;
}

/** File-level sweep shared by the rule's single traversal. */
export function collectLoopsAndAwaits(file: SourceFileView): {
	loops: Node[];
	awaits: Node[];
} {
	const loops: Node[] = [];
	const awaits: Node[] = [];
	const LOOP_KINDS: readonly SyntaxKind[] = [
		SyntaxKind.ForStatement,
		SyntaxKind.WhileStatement,
		SyntaxKind.DoStatement,
	];
	file.forEachDescendant((node) => {
		if (LOOP_KINDS.includes(node.getKind())) loops.push(node);
		if (node.getKind() === SyntaxKind.AwaitExpression) awaits.push(node);
		return undefined;
	});
	return { loops, awaits };
}
