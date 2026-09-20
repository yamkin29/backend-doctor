import {
	type CallExpression,
	type Expression,
	Node,
	SyntaxKind,
} from "../../engine/parser/types.js";
import { defineRule } from "../../engine/registry.js";
import { findModuleApiCalls } from "../shared/module-api-calls.js";
import { containsRequestInput } from "./request-input.js";

const MERGE_FAMILY = [
	"merge",
	"mergeWith",
	"defaultsDeep",
	"deepmerge",
] as const;

function anyArgumentHasRequestInput(call: CallExpression): boolean {
	return call.getArguments().some((argument) => {
		if (argument.getKind() === SyntaxKind.SpreadElement) return false;
		return containsRequestInput(argument as Expression);
	});
}

/**
 * Bare merge-family names (shadow-checked, ungateable — lodash-shaped);
 * property form only on `Object` for `assign` and on `_`/`lodash` for the
 * merge family. Anything else (`map.merge`, a user's `opts.assign`) is
 * treated as trusted code.
 */
function isMergeCallee(call: CallExpression, name: string): boolean {
	if (Node.isIdentifier(call.getExpression())) {
		return (MERGE_FAMILY as readonly string[]).includes(name);
	}
	const access = call
		.getExpression()
		.asKind(SyntaxKind.PropertyAccessExpression);
	if (!access) return false;
	const receiver = access.getExpression();
	if (!Node.isIdentifier(receiver)) return false;
	const receiverName = receiver.getText();
	if (name === "assign") return receiverName === "Object";
	return (
		(receiverName === "_" || receiverName === "lodash") &&
		(MERGE_FAMILY as readonly string[]).includes(name)
	);
}

/**
 * Flags merging request data into objects (spec 007, open question 3):
 * `__proto__`/`constructor` keys in the merged input reach the prototype.
 * `Object.assign` is included — its set semantics make it a real pollution
 * vector despite being shallow. Spread syntax is not a call and not flagged.
 */
export const noUnsafeMerge = defineRule({
	id: "backend-doctor/no-unsafe-merge",
	title: "No unsafe merge",
	category: "Security",
	severity: "warn",
	docs: "docs/rules/backend-doctor/no-unsafe-merge.md",
	create(ctx) {
		for (const { call } of findModuleApiCalls(ctx.file, {
			names: [...MERGE_FAMILY, "assign"],
			accept: (call, name) =>
				isMergeCallee(call, name) && anyArgumentHasRequestInput(call),
			insideFunctionBodies: false,
		})) {
			ctx.report({
				node: call,
				message:
					'Merging request data into an object lets "__proto__" and "constructor" keys reach the prototype (prototype pollution). Use a prototype-safe merge or strip those keys first.',
			});
		}
	},
});
