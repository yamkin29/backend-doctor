import { type CallExpression, SyntaxKind } from "../../engine/parser/types.js";
import { defineRule } from "../../engine/registry.js";
import { findModuleApiCalls } from "../shared/module-api-calls.js";

const CRYPTO_SPECIFIERS = ["crypto", "node:crypto"] as const;

/** The PLAN's v1 list; non-literal algorithms cannot be resolved. */
const WEAK_ALGORITHMS = new Set(["md5", "sha1"]);

function isWeakAlgorithm(call: CallExpression): boolean {
	const first = call.getArguments()[0];
	if (first === undefined) return false;
	const literal = first.asKind(SyntaxKind.StringLiteral);
	return (
		literal !== undefined &&
		WEAK_ALGORITHMS.has(literal.getLiteralText().toLowerCase())
	);
}

/**
 * Flags createHash("md5"/"sha1") calls (spec 007): broken for signatures,
 * passwords, tokens. No top-level exemption and no function-body scope — a
 * weak hash is weak wherever it runs. Cache-key/etag use is the known
 * acceptable case; the rule doc says to downgrade or ignore for it.
 */
export const noWeakCrypto = defineRule({
	id: "backend-doctor/no-weak-crypto",
	title: "No weak crypto",
	category: "Security",
	severity: "warn",
	docs: "docs/rules/backend-doctor/no-weak-crypto.md",
	create(ctx) {
		for (const { call } of findModuleApiCalls(ctx.file, {
			specifiers: CRYPTO_SPECIFIERS,
			names: ["createHash"],
			accept: isWeakAlgorithm,
			insideFunctionBodies: false,
		})) {
			ctx.report({
				node: call,
				message:
					"MD5 and SHA-1 are broken for security uses such as signatures, passwords and tokens. Use SHA-256 or stronger; for non-security checksums, downgrade or ignore this rule.",
			});
		}
	},
});
