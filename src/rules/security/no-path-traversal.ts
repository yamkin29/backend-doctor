import {
	type CallExpression,
	Node,
	SyntaxKind,
} from "../../engine/parser/types.js";
import { defineRule } from "../../engine/registry.js";
import { findModuleApiCalls } from "../shared/module-api-calls.js";
import { containsRequestInput } from "./request-input.js";

const PATH_SPECIFIERS = ["path", "node:path"] as const;
const PATH_BUILDERS = ["join", "resolve"] as const;

/**
 * join/resolve collide with common methods (Array.prototype.join, http
 * clients, maps), so — unlike the F006 module rules — the property form is
 * accepted only on a receiver that is literally the identifier `path`. Bare
 * join/resolve keep the collector's shadow check.
 */
function isPathReceiver(call: CallExpression): boolean {
	const access = call
		.getExpression()
		.asKind(SyntaxKind.PropertyAccessExpression);
	if (!access) return true;
	const receiver = access.getExpression();
	return Node.isIdentifier(receiver) && receiver.getText() === "path";
}

function hasRequestArgument(call: CallExpression): boolean {
	return call.getArguments().some((argument) => {
		if (argument.getKind() === SyntaxKind.SpreadElement) return false;
		return containsRequestInput(
			argument as Parameters<typeof containsRequestInput>[0],
		);
	});
}

/**
 * Flags path building from request data (spec 007): the classic
 * `path.join(base, req.params.file)` lets ".." escape the intended
 * directory. Aliased default imports and `require("path").join` are
 * documented recall holes.
 */
export const noPathTraversal = defineRule({
	id: "backend-doctor/no-path-traversal",
	title: "No path traversal",
	category: "Security",
	severity: "warn",
	docs: "docs/rules/backend-doctor/no-path-traversal.md",
	create(ctx) {
		for (const { call } of findModuleApiCalls(ctx.file, {
			specifiers: PATH_SPECIFIERS,
			names: PATH_BUILDERS,
			accept: (call) => isPathReceiver(call) && hasRequestArgument(call),
			insideFunctionBodies: false,
		})) {
			ctx.report({
				node: call,
				message:
					'Path segments taken from request data allow ".." traversal out of the intended directory. Normalize with path.basename or validate the value against an allowlist before joining.',
			});
		}
	},
});
