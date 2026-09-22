/**
 * Golden data for the eval corpus (spec 022). Machine-independent by
 * construction: target-relative paths, no messages (per-rule fixture tests
 * own the exact-message contract), no ids (derivable from the pinned
 * fields). Diagnostic goldens are pinned in report order.
 */

/** evals/nest-good analyzed files, target-relative, sorted. */
export const GOOD_APP_FILES: readonly string[] = [
	"src/app.module.ts",
	"src/config/config.module.ts",
	"src/config/config.service.ts",
	"src/health/health.controller.ts",
	"src/main.ts",
	"src/prisma/prisma.module.ts",
	"src/prisma/prisma.service.ts",
	"src/users/dto/create-user.dto.ts",
	"src/users/dto/list-users.dto.ts",
	"src/users/users.controller.ts",
	"src/users/users.module.ts",
	"src/users/users.service.ts",
];

/** evals/nest-bad analyzed files, target-relative, sorted. */
export const BAD_APP_FILES: readonly string[] = [];

/**
 * evals/nest-bad's full diagnostic set in report order. Filled in T3 from a
 * live scan — the ordering must mirror sortDiagnostics exactly.
 */
export interface GoldenDiagnostic {
	file: string;
	line: number;
	column: number;
	rule: string;
	category: string;
	severity: string;
}

export const BAD_APP_DIAGNOSTICS: readonly GoldenDiagnostic[] = [];
