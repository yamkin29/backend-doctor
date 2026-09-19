import type { CallExpression } from "../../engine/parser/types.js";
import { defineRule } from "../../engine/registry.js";
import { findSyncModuleCalls } from "./sync-module-calls.js";

/**
 * Crypto functions that are always synchronous — key derivation and
 * parameter generation block the loop for the full computation cost
 * (design §2).
 */
const CRYPTO_ALWAYS = [
	"pbkdf2Sync",
	"scryptSync",
	"generateKeyPairSync",
	"generatePrimeSync",
	"hkdfSync",
	"randomFillSync",
] as const;

/**
 * `randomBytes`/`randomFill` are sync without a callback argument and async
 * with one (design decision 5). A spread-only argument list is
 * indistinguishable from the sync form — documented recall hole.
 */
const CRYPTO_WHEN_NO_CALLBACK = ["randomBytes", "randomFill"] as const;

const CRYPTO_SPECIFIERS = ["crypto", "node:crypto"] as const;

function isSyncForm(call: CallExpression, name: string): boolean {
	if ((CRYPTO_ALWAYS as readonly string[]).includes(name)) return true;
	if ((CRYPTO_WHEN_NO_CALLBACK as readonly string[]).includes(name)) {
		return call.getArguments().length < 2;
	}
	return false;
}

/**
 * Flags synchronous crypto calls inside function bodies — key derivation
 * and callback-less random-byte generation block the event loop for the
 * full computation (spec 006). Module top level is exempt.
 */
export const noSyncCrypto = defineRule({
	id: "backend-doctor/no-sync-crypto",
	title: "No sync crypto",
	category: "Performance",
	severity: "warn",
	docs: "docs/rules/backend-doctor/no-sync-crypto.md",
	create(ctx) {
		for (const { call } of findSyncModuleCalls(ctx.file, {
			specifiers: CRYPTO_SPECIFIERS,
			names: [...CRYPTO_ALWAYS, ...CRYPTO_WHEN_NO_CALLBACK],
			accept: isSyncForm,
		})) {
			ctx.report({
				node: call,
				message:
					"Synchronous crypto work (key derivation, random bytes) blocks the event loop for the full computation. Use the callback or promisified async API instead.",
			});
		}
	},
});
