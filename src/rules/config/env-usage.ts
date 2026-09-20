import {
	type Node,
	type SourceFileView,
	SyntaxKind,
} from "../../engine/parser/types.js";

/**
 * Shared env-access census for the config/env pack (spec 014): collects
 * the direct `process.env` access nodes of one parsed file, in traversal
 * order. Both env rules consume it — the file rule reports each access,
 * the project rule counts them and positions at the first.
 */
export function collectEnvAccesses(file: SourceFileView): Node[] {
	const accesses: Node[] = [];
	file.forEachDescendant((node) => {
		if (isDirectEnvAccess(node)) accesses.push(node);
		return undefined;
	});
	return accesses;
}

/**
 * True for the per-chain anchor of a direct env access: a property access
 * (or string-keyed element access) whose immediate base is exactly the
 * `process.env` chain rooted at the `process` identifier. A longer chain
 * (`process.env.FOO.BAR`) matches once, at its `process.env.FOO` node, so
 * one access site yields one finding (design decision 2). Whole-env reads
 * (bare `process.env`), dynamic element keys, parenthesized bases and
 * other roots (`globalThis.process`) never match — documented recall
 * holes in the consuming rules' docs.
 */
function isDirectEnvAccess(node: Node): boolean {
	const property = node.asKind(SyntaxKind.PropertyAccessExpression);
	if (property) return isProcessEnvBase(property.getExpression());
	const element = node.asKind(SyntaxKind.ElementAccessExpression);
	if (element) {
		const argument = element.getArgumentExpression();
		if (!argument?.asKind(SyntaxKind.StringLiteral)) return false;
		return isProcessEnvBase(element.getExpression());
	}
	return false;
}

function isProcessEnvBase(expression: Node): boolean {
	const access = expression.asKind(SyntaxKind.PropertyAccessExpression);
	if (!access || access.getName() !== "env") return false;
	const root = access.getExpression().asKind(SyntaxKind.Identifier);
	return root?.getText() === "process";
}
