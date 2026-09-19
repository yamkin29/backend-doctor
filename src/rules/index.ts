import { registerRule } from "../engine/registry.js";
import { noAsyncConstructorWork } from "./async/no-async-constructor-work.js";
import { noAsyncForeachCallback } from "./async/no-async-foreach-callback.js";
import { noFloatingPromises } from "./async/no-floating-promises.js";
import { noUnhandledEmitterError } from "./async/no-unhandled-emitter-error.js";
import { unhandledJsonParse } from "./async/unhandled-json-parse.js";
import { noSyncFsInRequestPath } from "./blocking/sync-fs.js";
import { noEval } from "./security/no-eval.js";
import { noNewFunc } from "./security/no-new-func.js";

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
];

for (const rule of productRules) {
	registerRule(rule);
}
