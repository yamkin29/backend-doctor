import {
	type CallExpression,
	Node,
	type SourceFileView,
	SyntaxKind,
} from "../../engine/parser/types.js";
import { defineRule } from "../../engine/registry.js";
import { findModuleApiCalls } from "../shared/module-api-calls.js";
import {
	isAwaitedCall,
	isInsideNode,
	isRootedAt,
	unwrapParens,
} from "./prisma-calls.js";

/**
 * Delay logic inside the transaction callback: the transaction waits on
 * these wherever they sit (a timer inside a `new Promise` executor still
 * delays it), so containment here does not stop at function boundaries.
 */
const TIMERS = ["setTimeout", "setInterval"] as const;

/**
 * HTTP verbs on an `axios`-rooted receiver (spec 012 design decision 6).
 * Matched on the root so `map.get` and friends never enter the candidate
 * set; Nest's `HttpService` (`this.http.get`) is a documented recall hole.
 */
const HTTP_CALLS = [
	"get",
	"post",
	"put",
	"patch",
	"delete",
	"request",
] as const;

/**
 * Flags external I/O and delays inside an interactive `$transaction`
 * callback (spec 012 AC-4): row locks are held while the transaction waits.
 * `fetch`/axios calls must be awaited — an unawaited call does not make the
 * transaction wait and is already the floating-promise pack's finding — so
 * the two rules partition. The array form `$transaction([…])` is a fixed
 * batch and never matches.
 */
export const noLongRunningTransaction = defineRule({
	id: "backend-doctor/no-long-running-transaction",
	title: "No long-running transactions",
	category: "Performance",
	severity: "warn",
	docs: "docs/rules/backend-doctor/no-long-running-transaction.md",
	frameworks: ["prisma"],
	create(ctx) {
		const callbacks = findTransactionCallbacks(ctx.file);
		if (callbacks.length === 0) return;
		const offenders = [
			...findModuleApiCalls(ctx.file, {
				names: ["fetch", ...TIMERS],
				accept: (call, name) => (name === "fetch" ? isAwaitedCall(call) : true),
			}),
			...findModuleApiCalls(ctx.file, {
				names: HTTP_CALLS,
				accept: (call) => isRootedAt(call, "axios") && isAwaitedCall(call),
			}),
		];
		for (const callback of callbacks) {
			for (const { call, name } of offenders) {
				if (!isInsideNode(call, callback)) continue;
				ctx.report({
					node: call,
					message: `${displayName(call, name)} runs inside an interactive $transaction: the transaction holds its locks while waiting on external I/O. Move external calls and delays outside the transaction and keep only Prisma statements inside.`,
				});
			}
		}
	},
});

function findTransactionCallbacks(file: SourceFileView): Node[] {
	const callbacks: Node[] = [];
	file.forEachDescendant((node) => {
		const call = node.asKind(SyntaxKind.CallExpression);
		if (!call) return undefined;
		const callee = unwrapParens(call.getExpression());
		if (
			!Node.isPropertyAccessExpression(callee) ||
			callee.getName() !== "$transaction"
		) {
			return undefined;
		}
		const callback = call.getArguments()[0];
		const fn =
			callback?.asKind(SyntaxKind.ArrowFunction) ??
			callback?.asKind(SyntaxKind.FunctionExpression);
		if (fn) callbacks.push(fn);
		return undefined;
	});
	return callbacks;
}

function displayName(call: CallExpression, name: string): string {
	return isRootedAt(call, "axios") ? `axios.${name}` : name;
}
