import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import {
	DEFAULT_ACTION_REF,
	renderWorkflowTemplate,
} from "../../ci/workflow-template.js";

export interface CiInstallOptions {
	force?: boolean;
	actionRef?: string;
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
