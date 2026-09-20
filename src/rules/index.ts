import { registerRule } from "../engine/registry.js";
import { noAsyncConstructorWork } from "./async/no-async-constructor-work.js";
import { noAsyncForeachCallback } from "./async/no-async-foreach-callback.js";
import { noFloatingPromises } from "./async/no-floating-promises.js";
import { noUnhandledEmitterError } from "./async/no-unhandled-emitter-error.js";
import { unhandledJsonParse } from "./async/unhandled-json-parse.js";
import { noCpuBoundLoop } from "./blocking/cpu-bound-loop.js";
import { noSyncCrypto } from "./blocking/sync-crypto.js";
import { noSyncFsInRequestPath } from "./blocking/sync-fs.js";
import { circularDi } from "./nest/circular-di.js";
import { missingForwardRef } from "./nest/missing-forward-ref.js";
import { providerNotRegistered } from "./nest/provider-not-registered.js";
import { requestScopedInSingleton } from "./nest/request-scoped-in-singleton.js";
import { noCommandInjection } from "./security/no-command-injection.js";
import { noEval } from "./security/no-eval.js";
import { noHardcodedSecrets } from "./security/no-hardcoded-secrets.js";
import { noNewFunc } from "./security/no-new-func.js";
import { noPathTraversal } from "./security/no-path-traversal.js";
import { noSsrf } from "./security/no-ssrf.js";
import { noUnsafeMerge } from "./security/no-unsafe-merge.js";
import { noWeakCrypto } from "./security/no-weak-crypto.js";

/**
 * Explicit, greppable product registry (design decision: "boring"). Every
 * shipped rule must appear in this array; importing this module registers
 * them with the engine.
 */
const productRules = [
	noEval,
	noNewFunc,
	noFloatingPromises,
	noAsyncConstructorWork,
	noAsyncForeachCallback,
	unhandledJsonParse,
	noUnhandledEmitterError,
	noSyncFsInRequestPath,
	noSyncCrypto,
	noCpuBoundLoop,
	noCommandInjection,
	noPathTraversal,
	noHardcodedSecrets,
	noWeakCrypto,
	noSsrf,
	noUnsafeMerge,
	providerNotRegistered,
	circularDi,
	missingForwardRef,
	requestScopedInSingleton,
];

for (const rule of productRules) {
	registerRule(rule);
}
