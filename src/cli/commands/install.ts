import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { resolveSkillSourceDir } from "../install-source.js";

/**
 * `backend-doctor install` — copies the shipped agent skill
 * (skills/backend-doctor/) into the conventions of Agent Skills-aware
 * agents (spec 024). Non-interactive and deterministic: no flags → a
 * detection report with zero writes; explicit --agent installs; identical
 * content is a no-op; drifted content refuses with exit 2 unless --force.
 *
 * Exit codes (constitution §5): 0 ok (install, no-op, detection), 2 usage or
 * environment errors (unknown validation is handled by commander, missing
 * source, drift refusal). Exit 1 stays diagnostics-only.
 */

export type InstallAgent = "claude-code" | "codex";
export type InstallScope = "project" | "global";
export type InstallStatus = "absent" | "up to date" | "differs";

export const INSTALL_AGENTS: readonly InstallAgent[] = ["claude-code", "codex"];

/** The skill directory each agent convention owns, relative to its scope root. */
const AGENT_SKILL_ROOTS: Record<InstallAgent, string> = {
	"claude-code": path.join(".claude", "skills"),
	codex: path.join(".codex", "skills"),
};

const SKILL_DIR_NAME = "backend-doctor";

export interface InstallCommandOptions {
	agent?: string;
	scope?: string;
	force?: boolean;
}

export interface InstallRoots {
	cwd: string;
	home: string;
	sourceDir: string;
}

function defaultRoots(): InstallRoots {
	return {
		cwd: process.cwd(),
		home: os.homedir(),
		sourceDir: resolveSkillSourceDir(),
	};
}

/** Spec 024: the directory an install writes to for one agent × scope. */
export function targetDirFor(
	agent: InstallAgent,
	scope: InstallScope,
	cwd: string,
	home: string,
): string {
	const scopeRoot = scope === "global" ? home : cwd;
	return path.join(scopeRoot, AGENT_SKILL_ROOTS[agent], SKILL_DIR_NAME);
}

function folderHasFiles(dir: string): boolean {
	return fs.existsSync(dir) && fs.statSync(dir).isDirectory();
}

/**
 * Whole-folder comparison: same relative file set, byte-identical contents.
 * A missing target is "absent"; anything else that differs is "differs" —
 * including extra files the source does not have.
 */
export function installStatus(
	sourceDir: string,
	targetDir: string,
): InstallStatus {
	if (!folderHasFiles(targetDir)) {
		return "absent";
	}
	const walk = (dir: string, rel: string): Map<string, string> => {
		const files = new Map<string, string>();
		for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
			const child = path.join(dir, entry.name);
			const relNext = rel ? `${rel}/${entry.name}` : entry.name;
			if (entry.isDirectory()) {
				for (const [nested, content] of walk(child, relNext)) {
					files.set(nested, content);
				}
			} else {
				files.set(relNext, fs.readFileSync(child, "utf8"));
			}
		}
		return files;
	};
	const source = walk(sourceDir, "");
	const target = walk(targetDir, "");
	if (source.size !== target.size) {
		return "differs";
	}
	for (const [rel, content] of source) {
		if (target.get(rel) !== content) {
			return "differs";
		}
	}
	return "up to date";
}

interface ReportRow {
	agent: InstallAgent;
	scope: InstallScope;
	targetDir: string;
	status: InstallStatus;
}

function formatReport(sourceDir: string, rows: ReportRow[]): string {
	const agentWidth = Math.max(...rows.map((row) => row.agent.length));
	const scopeWidth = Math.max(...rows.map((row) => row.scope.length));
	const pathWidth = Math.max(...rows.map((row) => row.targetDir.length));
	const lines = rows.map(
		(row) =>
			`${row.agent.padEnd(agentWidth)}  ${row.scope.padEnd(scopeWidth)}  ${row.targetDir.padEnd(pathWidth)}  ${row.status}`,
	);
	return `Skill source: ${sourceDir}\n${lines.join("\n")}\n`;
}

function copySkill(sourceDir: string, targetDir: string): void {
	fs.mkdirSync(path.dirname(targetDir), { recursive: true });
	fs.cpSync(sourceDir, targetDir, { recursive: true });
}

/**
 * Runs the install command against the given roots. Defaults resolve cwd,
 * home and the shipped skill folder; tests inject all three.
 */
export function installCommand(
	opts: InstallCommandOptions,
	roots: InstallRoots = defaultRoots(),
): number {
	const sourceDir = roots.sourceDir;
	if (!folderHasFiles(sourceDir)) {
		process.stderr.write(`Skill source not found: ${sourceDir}\n`);
		return 2;
	}

	if (opts.agent === undefined) {
		// Detection report: computed first, printed after — zero writes.
		const rows: ReportRow[] = [];
		for (const agent of INSTALL_AGENTS) {
			for (const scope of ["project", "global"] as const) {
				const targetDir = targetDirFor(agent, scope, roots.cwd, roots.home);
				rows.push({
					agent,
					scope,
					targetDir,
					status: installStatus(sourceDir, targetDir),
				});
			}
		}
		process.stdout.write(formatReport(sourceDir, rows));
		return 0;
	}

	const agent = opts.agent as InstallAgent;
	// commander's .choices() guarantees the value set; the cast mirrors
	// scanCommand's format handling in run.ts.
	const scope = (opts.scope ?? "project") as InstallScope;
	const targetDir = targetDirFor(agent, scope, roots.cwd, roots.home);
	const status = installStatus(sourceDir, targetDir);

	if (status === "up to date") {
		process.stdout.write(`Up to date: ${targetDir}\n`);
		return 0;
	}
	if (status === "differs" && !opts.force) {
		process.stderr.write(
			`Skill differs at ${targetDir}\nSource: ${sourceDir}\nRe-run with --force to overwrite.\n`,
		);
		return 2;
	}

	fs.rmSync(targetDir, { recursive: true, force: true });
	copySkill(sourceDir, targetDir);
	process.stdout.write(
		`${status === "absent" ? "Created" : "Updated"} ${targetDir}\n`,
	);
	return 0;
}
