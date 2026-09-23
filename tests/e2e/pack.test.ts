import { execFile } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);

const repoRoot = path.resolve(fileURLToPath(import.meta.url), "../../..");

/**
 * Spec 023 AC-1: the exact file set `npm pack` must report for the published
 * tarball. npm always adds package.json, README.md and LICENSE on its own;
 * everything else comes from the `files` field. The list is pinned in full —
 * deliberate changes update it in the same commit, accidental ones fail here.
 * Order-sensitive assertion input is sorted because npm's output order is its
 * own; the expected constant is kept sorted for a readable diff.
 */
const PINNED_TARBALL_FILES = [
	"LICENSE",
	"README.md",
	"dist/bin/backend-doctor.d.ts",
	"dist/bin/backend-doctor.js",
	"dist/index.d.ts",
	"dist/index.js",
	"dist/probe/register.cjs",
	"docs/rules/backend-doctor/circular-dependency.md",
	"docs/rules/backend-doctor/circular-di.md",
	"docs/rules/backend-doctor/dto-field-without-validator.md",
	"docs/rules/backend-doctor/env-without-validation.md",
	"docs/rules/backend-doctor/find-many-without-pagination.md",
	"docs/rules/backend-doctor/missing-forward-ref.md",
	"docs/rules/backend-doctor/missing-global-validation-pipe.md",
	"docs/rules/backend-doctor/missing-on-module-destroy.md",
	"docs/rules/backend-doctor/no-any-in-dto.md",
	"docs/rules/backend-doctor/no-async-constructor-work.md",
	"docs/rules/backend-doctor/no-async-foreach-callback.md",
	"docs/rules/backend-doctor/no-business-logic-in-controller.md",
	"docs/rules/backend-doctor/no-command-injection.md",
	"docs/rules/backend-doctor/no-committed-env.md",
	"docs/rules/backend-doctor/no-cpu-bound-loop.md",
	"docs/rules/backend-doctor/no-direct-process-env.md",
	"docs/rules/backend-doctor/no-empty-catch.md",
	"docs/rules/backend-doctor/no-error-details-leak.md",
	"docs/rules/backend-doctor/no-eval.md",
	"docs/rules/backend-doctor/no-floating-promises.md",
	"docs/rules/backend-doctor/no-god-service.md",
	"docs/rules/backend-doctor/no-hardcoded-secrets.md",
	"docs/rules/backend-doctor/no-heavy-constructor-work.md",
	"docs/rules/backend-doctor/no-long-running-transaction.md",
	"docs/rules/backend-doctor/no-new-func.md",
	"docs/rules/backend-doctor/no-path-traversal.md",
	"docs/rules/backend-doctor/no-prisma-n-plus-one.md",
	"docs/rules/backend-doctor/no-repository-in-controller.md",
	"docs/rules/backend-doctor/no-ssrf.md",
	"docs/rules/backend-doctor/no-sync-crypto.md",
	"docs/rules/backend-doctor/no-sync-fs-in-request-path.md",
	"docs/rules/backend-doctor/no-unhandled-emitter-error.md",
	"docs/rules/backend-doctor/no-unsafe-merge.md",
	"docs/rules/backend-doctor/no-unsafe-raw-query.md",
	"docs/rules/backend-doctor/no-weak-crypto.md",
	"docs/rules/backend-doctor/provider-not-registered.md",
	"docs/rules/backend-doctor/request-scoped-in-singleton.md",
	"docs/rules/backend-doctor/unhandled-json-parse.md",
	"docs/rules/backend-doctor/unused-dependency.md",
	"docs/rules/backend-doctor/unused-export.md",
	"docs/rules/backend-doctor/unused-file.md",
	"package.json",
	"skills/backend-doctor/SKILL.md",
];

describe("npm tarball contents (spec 023 AC-1)", () => {
	it("packs exactly the pinned file set", { timeout: 30000 }, async () => {
		const { stdout } = await execFileAsync(
			"npm",
			["pack", "--dry-run", "--json"],
			{ cwd: repoRoot },
		);
		const report = JSON.parse(stdout) as Array<{
			files?: Array<{ path?: string }>;
		}>;
		const paths = (report[0]?.files ?? [])
			.map((file) => file.path ?? "")
			.sort();
		expect(paths).toEqual(PINNED_TARBALL_FILES);
	});
});
