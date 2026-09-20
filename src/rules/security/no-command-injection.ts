import { type CallExpression, Node } from "../../engine/parser/types.js";
import { defineRule } from "../../engine/registry.js";
import { findModuleApiCalls } from "../shared/module-api-calls.js";

const CHILD_PROCESS_SPECIFIERS = [
	"child_process",
	"node:child_process",
] as const;

/** exec/execSync invoke a shell — interpolation into them is exploitable. */
const SHELL_EXEC_NAMES = ["exec", "execSync"] as const;

/** A spread-only argument list is indistinguishable from the dynamic form. */
function hasDynamicCommand(call: CallExpression): boolean {
	const first = call.getArguments()[0];
	return first !== undefined && !Node.isStringLiteral(first);
}

/**
 * Flags dynamic shell commands (spec 007): exec/execSync from child_process
 * whose command is not a plain literal. Module top level is NOT exempt — an
 * injection path does not become safe at init. spawn/execFile with argument
 * arrays are the fix, not a finding.
 */
export const noCommandInjection = defineRule({
	id: "backend-doctor/no-command-injection",
	title: "No command injection",
	category: "Security",
	severity: "warn",
	docs: "docs/rules/backend-doctor/no-command-injection.md",
	create(ctx) {
		for (const { call } of findModuleApiCalls(ctx.file, {
			specifiers: CHILD_PROCESS_SPECIFIERS,
			names: SHELL_EXEC_NAMES,
			accept: hasDynamicCommand,
			insideFunctionBodies: false,
		})) {
			ctx.report({
				node: call,
				message:
					"This shell command is built dynamically, so request data can change what executes. Pass an argument array to execFile or spawn instead of interpolating input into an exec string.",
			});
		}
	},
});
