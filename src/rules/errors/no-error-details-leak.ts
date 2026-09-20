import {
	type CallExpression,
	Node,
	SyntaxKind,
} from "../../engine/parser/types.js";
import { defineRule } from "../../engine/registry.js";

/**
 * Response receivers are approximated by chains rooted at the exact
 * identifiers `res`/`response` — the near-universal Express/Nest naming and
 * the `REQUEST_ROOTS` symmetry from spec 007 (design §4). The chain unwraps
 * through intermediate calls (`res.status(500).json(…)`) and parentheses.
 */
const RESPONSE_ROOTS = new Set(["res", "response"]);

const RESPONSE_METHODS = new Set(["json", "send", "end", "write"]);

function isResponseRooted(call: CallExpression): boolean {
	const callee = call
		.getExpression()
		.asKind(SyntaxKind.PropertyAccessExpression);
	if (!callee || !RESPONSE_METHODS.has(callee.getName())) return false;
	let receiver: Node | undefined = callee.getExpression();
	while (receiver) {
		if (Node.isIdentifier(receiver)) {
			return RESPONSE_ROOTS.has(receiver.getText());
		}
		if (
			Node.isCallExpression(receiver) ||
			Node.isParenthesizedExpression(receiver) ||
			// `res.status(500)` unwraps to the member access `res.status`, not
			// straight to the root identifier — keep unwrapping through it.
			Node.isPropertyAccessExpression(receiver)
		) {
			receiver = receiver.getExpression();
			continue;
		}
		return false;
	}
	return false;
}

/** True when the expression is, or contains, a `.stack` property access. */
function hasStackAccess(node: Node): boolean {
	if (Node.isPropertyAccessExpression(node) && node.getName() === "stack") {
		return true;
	}
	let found = false;
	node.forEachDescendant((inner) => {
		if (found) return "skip";
		if (Node.isPropertyAccessExpression(inner) && inner.getName() === "stack") {
			found = true;
		}
		return undefined;
	});
	return found;
}

/**
 * Flags stack traces shipped to the client through a response call (spec 011
 * AC-2): `res.status(500).json({ stack: err.stack })` and the Nest filter
 * idiom `response.status(…).json({ …, stack: exception.stack })`. `.stack`
 * only — resolution 1: intentional `message` returns are idiomatic 4xx
 * shape. One diagnostic per response call regardless of reference count.
 */
export const noErrorDetailsLeak = defineRule({
	id: "backend-doctor/no-error-details-leak",
	title: "No error details leak",
	category: "Security",
	severity: "warn",
	docs: "docs/rules/backend-doctor/no-error-details-leak.md",
	create(ctx) {
		ctx.file.forEachDescendant((node) => {
			const call = node.asKind(SyntaxKind.CallExpression);
			if (!call) return undefined;
			if (!isResponseRooted(call)) return undefined;
			if (!call.getArguments().some(hasStackAccess)) return undefined;
			ctx.report({
				node: call,
				message:
					"A stack trace reaches the client through this response; stacks expose file paths and internal structure. Log the error server-side and return a generic message or a safe error payload instead.",
			});
			return undefined;
		});
	},
});
