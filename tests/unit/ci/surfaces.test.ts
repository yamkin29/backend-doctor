import { describe, expect, it } from "vitest";
import {
	blockingExitCode,
	buildSurfaces,
	STICKY_MARKER,
} from "../../../src/ci/surfaces.js";
import type {
	PullRequestContext,
	SurfaceOptions,
} from "../../../src/ci/types.js";
import type { Diagnostic, ReportDocument } from "../../../src/core/types.js";

const context: PullRequestContext = {
	repository: "acme/widgets",
	prNumber: 7,
	baseRef: "main",
	headSha: "abc123",
	apiUrl: "https://api.github.com",
	serverUrl: "https://github.com",
	runId: "42",
};

function diag(
	over: Partial<Diagnostic> & { filePath: string; line: number },
): Diagnostic {
	return {
		id: "d",
		column: 1,
		rule: "backend-doctor/rule-x",
		category: "Bugs",
		severity: "warn",
		message: "something is off",
		tags: [],
		...over,
	};
}

function doc(over: Partial<ReportDocument> = {}): ReportDocument {
	return {
		schemaVersion: 1,
		mode: "lines",
		scope: { base: "origin/main" },
		directory: "/repo",
		diagnostics: [],
		projects: [],
		...over,
	};
}

function opts(over: Partial<SurfaceOptions> = {}): SurfaceOptions {
	return {
		blocking: "none",
		comment: true,
		reviewComments: true,
		commitStatus: true,
		maxReviewComments: 50,
		context,
		...over,
	};
}

const FINDINGS: Diagnostic[] = [
	diag({
		id: "d1",
		filePath: "/repo/src/users.service.ts",
		line: 42,
		severity: "error",
		rule: "backend-doctor/no-floating-promises",
		message: "unawaited promise",
	}),
	diag({
		id: "d2",
		filePath: "/repo/src/users.service.ts",
		line: 9,
		rule: "backend-doctor/no-eval",
		message: "eval usage",
	}),
	diag({
		id: "d3",
		filePath: "/repo/src/other.ts",
		line: 2,
		rule: "backend-doctor/no-sync-fs",
		message: "sync fs",
	}),
];

describe("buildSurfaces — comment", () => {
	it("summarizes counts with pluralization and the scope line", () => {
		const env = buildSurfaces(doc({ diagnostics: FINDINGS }), opts());
		const body = env.comment?.body ?? "";
		expect(body).toContain("**1 error, 2 warnings** found");
		expect(body).toContain("scope: lines, base: origin/main");
	});

	it("groups findings by file with rules, severities and lines", () => {
		const env = buildSurfaces(doc({ diagnostics: FINDINGS }), opts());
		const body = env.comment?.body ?? "";
		expect(body).toContain("### src/users.service.ts");
		expect(body).toContain("### src/other.ts");
		expect(body).toContain(
			"L42 — `backend-doctor/no-floating-promises` (error): unawaited promise",
		);
		expect(body).toContain("L9 — `backend-doctor/no-eval` (warn): eval usage");
	});

	it("ends with the sticky marker", () => {
		const env = buildSurfaces(doc({ diagnostics: FINDINGS }), opts());
		expect(env.comment?.body.trimEnd().endsWith(STICKY_MARKER)).toBe(true);
	});

	it("notes skipped checks when present", () => {
		const d = doc({
			diagnostics: FINDINGS,
			projects: [
				{
					packageRoot: "/repo",
					frameworks: [],
					analyzedFiles: [],
					analyzedFileCount: 3,
					complete: false,
					skippedChecks: [
						{
							check: "project-rules",
							reason: "skipped: lines scope analyzes a file subset",
						},
					],
				},
			],
		});
		const body = buildSurfaces(d, opts()).comment?.body ?? "";
		expect(body).toContain("1 check skipped in this scope");
		expect(body).toContain(
			"project-rules: skipped: lines scope analyzes a file subset",
		);
	});

	it("omits the skipped-check note when nothing was skipped", () => {
		const body =
			buildSurfaces(doc({ diagnostics: FINDINGS }), opts()).comment?.body ?? "";
		expect(body).not.toContain("skipped in this scope");
	});

	it("renders a zero-findings body without a findings section", () => {
		const body = buildSurfaces(doc(), opts()).comment?.body ?? "";
		expect(body).toContain("**0 errors, 0 warnings** found");
		expect(body).toContain("No findings in this scope");
		expect(body).not.toContain("### ");
	});

	it("appends the +N more note when review comments are capped", () => {
		const env = buildSurfaces(
			doc({ diagnostics: FINDINGS }),
			opts({
				maxReviewComments: 2,
			}),
		);
		expect(env.comment?.body).toContain("1 more omitted");
	});
});

describe("buildSurfaces — review comments", () => {
	it("emits payloads in report order with commit id and side", () => {
		const env = buildSurfaces(doc({ diagnostics: FINDINGS }), opts());
		expect(env.reviewComments).toHaveLength(3);
		expect(env.reviewComments?.[0]).toEqual({
			commit_id: "abc123",
			path: "src/users.service.ts",
			line: 42,
			side: "RIGHT",
			body: "**backend-doctor/no-floating-promises** (error): unawaited promise",
		});
		expect(env.reviewComments?.[1]?.line).toBe(9);
		expect(env.reviewComments?.[2]?.path).toBe("src/other.ts");
	});

	it("caps payloads at maxReviewComments", () => {
		const env = buildSurfaces(
			doc({ diagnostics: FINDINGS }),
			opts({
				maxReviewComments: 2,
			}),
		);
		expect(env.reviewComments).toHaveLength(2);
	});

	it("relativizes paths against the workspace root when given", () => {
		const env = buildSurfaces(
			doc({ diagnostics: FINDINGS }),
			opts({
				workspaceRoot: "/repo",
			}),
		);
		expect(env.reviewComments?.[0]?.path).toBe("src/users.service.ts");
	});

	it("falls back to the report directory when no workspace root is set", () => {
		const env = buildSurfaces(
			doc({
				diagnostics: [FINDINGS[2] as Diagnostic],
				directory: "/repo",
			}),
			opts(),
		);
		expect(env.reviewComments?.[0]?.path).toBe("src/other.ts");
	});

	it("keeps the absolute path when the file lies outside the base", () => {
		const env = buildSurfaces(
			doc({
				diagnostics: [diag({ filePath: "/elsewhere/x.ts", line: 1 })],
			}),
			opts(),
		);
		expect(env.reviewComments?.[0]?.path).toBe("/elsewhere/x.ts");
	});

	it("stays an empty array when enabled with zero findings", () => {
		const env = buildSurfaces(doc(), opts());
		expect(env.reviewComments).toEqual([]);
	});
});

describe("buildSurfaces — status", () => {
	it("reports success with counts under blocking none", () => {
		const env = buildSurfaces(doc({ diagnostics: FINDINGS }), opts());
		expect(env.status).toEqual({
			state: "success",
			description: "1 error, 2 warnings (blocking: none)",
			context: "backend-doctor",
			target_url: "https://github.com/acme/widgets/actions/runs/42",
		});
	});

	it("reports failure when the blocking threshold is hit", () => {
		const env = buildSurfaces(
			doc({ diagnostics: FINDINGS }),
			opts({
				blocking: "error",
			}),
		);
		expect(env.status?.state).toBe("failure");
	});
});

describe("buildSurfaces — disabled surfaces", () => {
	it("omits disabled keys from the envelope", () => {
		const env = buildSurfaces(
			doc({ diagnostics: FINDINGS }),
			opts({
				comment: false,
				reviewComments: false,
				commitStatus: false,
			}),
		);
		expect("comment" in env).toBe(false);
		expect("reviewComments" in env).toBe(false);
		expect("status" in env).toBe(false);
	});
});

describe("buildSurfaces — determinism", () => {
	it("is byte-identical for identical input", () => {
		const a = JSON.stringify(
			buildSurfaces(doc({ diagnostics: FINDINGS }), opts()),
		);
		const b = JSON.stringify(
			buildSurfaces(doc({ diagnostics: FINDINGS }), opts()),
		);
		expect(a).toBe(b);
	});
});

describe("blockingExitCode", () => {
	const withError = doc({ diagnostics: [FINDINGS[0] as Diagnostic] });
	const warnOnly = doc({ diagnostics: [FINDINGS[1] as Diagnostic] });
	const empty = doc();

	it.each([
		["none", withError, 0],
		["error", withError, 1],
		["error", warnOnly, 0],
		["warn", warnOnly, 1],
		["warn", withError, 1],
		["warn", empty, 0],
		["none", empty, 0],
	])("%s on %s findings exits %i", (mode, d, expected) => {
		expect(blockingExitCode(d, mode as "none" | "error" | "warn")).toBe(
			expected,
		);
	});
});
