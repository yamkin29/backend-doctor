import { registerProjectRule, registerRule } from "../engine/registry.js";
import { noAsyncConstructorWork } from "./async/no-async-constructor-work.js";
import { noAsyncForeachCallback } from "./async/no-async-foreach-callback.js";
import { noFloatingPromises } from "./async/no-floating-promises.js";
import { noUnhandledEmitterError } from "./async/no-unhandled-emitter-error.js";
import { unhandledJsonParse } from "./async/unhandled-json-parse.js";
import { noCpuBoundLoop } from "./blocking/cpu-bound-loop.js";
import { noSyncCrypto } from "./blocking/sync-crypto.js";
import { noSyncFsInRequestPath } from "./blocking/sync-fs.js";
import { envWithoutValidation } from "./config/env-without-validation.js";
import { noDirectProcessEnv } from "./config/no-direct-process-env.js";
import { noEmptyCatch } from "./errors/no-empty-catch.js";
import { noErrorDetailsLeak } from "./errors/no-error-details-leak.js";
import { circularDependency } from "./graph/circular-dependency.js";
import { unusedDependency } from "./graph/unused-dependency.js";
import { unusedExport } from "./graph/unused-export.js";
import { unusedFile } from "./graph/unused-file.js";
import { circularDi } from "./nest/circular-di.js";
import { dtoFieldWithoutValidator } from "./nest/dto-field-without-validator.js";
import { missingForwardRef } from "./nest/missing-forward-ref.js";
import { missingGlobalValidationPipe } from "./nest/missing-global-validation-pipe.js";
import { missingOnModuleDestroy } from "./nest/missing-on-module-destroy.js";
import { noAnyInDto } from "./nest/no-any-in-dto.js";
import { noBusinessLogicInController } from "./nest/no-business-logic-in-controller.js";
import { noGodService } from "./nest/no-god-service.js";
import { noHeavyConstructorWork } from "./nest/no-heavy-constructor-work.js";
import { noRepositoryInController } from "./nest/no-repository-in-controller.js";
import { providerNotRegistered } from "./nest/provider-not-registered.js";
import { requestScopedInSingleton } from "./nest/request-scoped-in-singleton.js";
import { findManyWithoutPagination } from "./prisma/find-many-without-pagination.js";
import { noLongRunningTransaction } from "./prisma/no-long-running-transaction.js";
import { noPrismaNPlusOne } from "./prisma/no-prisma-n-plus-one.js";
import { noUnsafeRawQuery } from "./prisma/no-unsafe-raw-query.js";
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
	noEmptyCatch,
	noErrorDetailsLeak,
	missingOnModuleDestroy,
	providerNotRegistered,
	circularDi,
	missingForwardRef,
	requestScopedInSingleton,
	noBusinessLogicInController,
	noRepositoryInController,
	noGodService,
	missingGlobalValidationPipe,
	dtoFieldWithoutValidator,
	noAnyInDto,
	noHeavyConstructorWork,
	findManyWithoutPagination,
	noLongRunningTransaction,
	noPrismaNPlusOne,
	noUnsafeRawQuery,
	noDirectProcessEnv,
];

const productProjectRules = [
	circularDependency,
	unusedDependency,
	unusedExport,
	unusedFile,
	envWithoutValidation,
];

for (const rule of productRules) {
	registerRule(rule);
}
for (const rule of productProjectRules) {
	registerProjectRule(rule);
}
