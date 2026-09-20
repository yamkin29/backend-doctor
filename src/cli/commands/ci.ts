import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { resolvePullRequestContext } from "../../ci/context.js";
import { postSurfaces } from "../../ci/poster.js";
import { blockingExitCode, buildSurfaces } from "../../ci/surfaces.js";
import type { BlockingMode } from "../../ci/types.js";
import {
	DEFAULT_ACTION_REF,
	renderWorkflowTemplate,
} from "../../ci/workflow-template.js";
import type { ReportDocument } from "../../core/types.js";
import { REPORT_SCHEMA_VERSION } from "../../core/types.js";

export interface CiInstallOptions {
	force?: boolean;
	actionRef?: string;
}

export interface CiReportOptions {
	report: string;
	blocking: BlockingMode;
	event?: string;
	comment: boolean;
	reviewComments: boolean;
	commitStatus: boolean;
	maxReviewComments: string;
	dryRun?: boolean;
}

const WORKFLOW_RELATIVE = path.join(
	".github",
	"workflows",
	"backend-doctor.yml",
);

/**
 * `ci install` — writes the PR workflow into the target repository
 * (spec 016 AC-1..AC-3). Byte-deterministic content; refuses to clobber a
 * hand-edited workflow unless --force (the `init` precedent, exit 2).
 */
export function ciInstallCommand(
	opts: CiInstallOptions,
	cwd = process.cwd(),
): number {
	const target = path.join(cwd, WORKFLOW_RELATIVE);
	if (fs.existsSync(target) && !opts.force) {
		process.stderr.write(
			`Workflow already exists: ${target} (use --force to overwrite)\n`,
		);
		return 2;
	}
	try {
		fs.mkdirSync(path.dirname(target), { recursive: true });
		fs.writeFileSync(
			target,
			renderWorkflowTemplate(opts.actionRef ?? DEFAULT_ACTION_REF),
		);
	} catch (error) {
		process.stderr.write(
			`Cannot write workflow: ${(error as Error).message}\n`,
		);
		return 2;
	}
	process.stdout.write(`Created ${target}\n`);
	return 0;
}

function loadReport(
	file: string,
): { ok: true; doc: ReportDocument } | { ok: false; error: string } {
	let raw: string;
	try {
		raw = fs.readFileSync(file, "utf8");
	} catch (error) {
		return {
			ok: false,
			error: `Cannot read report file ${file}: ${(error as Error).message}`,
		};
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch (error) {
		return {
			ok: false,
			error: `Cannot parse report file ${file}: ${(error as Error).message}`,
		};
	}
	const doc = parsed as Partial<ReportDocument>;
	if (doc.schemaVersion !== REPORT_SCHEMA_VERSION) {
		return {
			ok: false,
			error: `Unsupported report schemaVersion: ${String(doc.schemaVersion)} in ${file} (expected ${REPORT_SCHEMA_VERSION})`,
		};
	}
	if (!Array.isArray(doc.diagnostics) || !Array.isArray(doc.projects)) {
		return {
			ok: false,
			error: `Malformed report file ${file}: diagnostics/projects must be arrays`,
		};
	}
	return { ok: true, doc: doc as ReportDocument };
}

/**
 * `ci report` — reads a scan JSON report plus the GitHub Actions context
 * and either prints the exact payloads (--dry-run) or posts them
 * (spec 016 AC-5..AC-13). Exit 1 mirrors "diagnostics found" at the
 * configured blocking level; posting failures only warn on stderr and
 * never mask the blocking verdict.
 */
export async function ciReportCommand(
	opts: CiReportOptions,
	env: NodeJS.ProcessEnv = process.env,
): Promise<number> {
	const maxReviewComments = Number.parseInt(opts.maxReviewComments, 10);
	if (!Number.isInteger(maxReviewComments) || maxReviewComments < 1) {
		process.stderr.write("--max-review-comments must be a positive integer\n");
		return 2;
	}

	const resolution = resolvePullRequestContext({ eventPath: opts.event, env });
	if (!resolution.ok) {
		process.stderr.write(`${resolution.error}\n`);
		return 2;
	}

	const loaded = loadReport(opts.report);
	if (!loaded.ok) {
		process.stderr.write(`${loaded.error}\n`);
		return 2;
	}

	const surfaces = buildSurfaces(loaded.doc, {
		blocking: opts.blocking,
		comment: opts.comment,
		reviewComments: opts.reviewComments,
		commitStatus: opts.commitStatus,
		maxReviewComments,
		context: resolution.context,
		workspaceRoot: env.GITHUB_WORKSPACE,
	});
	const exit = blockingExitCode(loaded.doc, opts.blocking);

	if (opts.dryRun) {
		process.stdout.write(`${JSON.stringify(surfaces, null, "\t")}\n`);
		return exit;
	}

	const warnings = await postSurfaces(surfaces, {
		context: resolution.context,
		token: env.GITHUB_TOKEN || undefined,
		fetchImpl: fetch,
	});
	for (const warning of warnings) {
		process.stderr.write(`${warning}\n`);
	}
	return exit;
}
