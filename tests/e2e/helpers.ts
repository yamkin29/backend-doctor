import { execFile, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { expect } from "vitest";

const binPath = path.resolve(
	fileURLToPath(import.meta.url),
	"../../../dist/bin/backend-doctor.js",
);

const execFileAsync = promisify(execFile);

export interface CliResult {
	stdout: string;
	stderr: string;
	exitCode: number;
}

export function runCli(
	args: string[],
	opts?: { cwd?: string; env?: Record<string, string> },
): CliResult {
	const res = spawnSync(process.execPath, [binPath, ...args], {
		encoding: "utf8",
		cwd: opts?.cwd,
		env: opts?.env ? { ...process.env, ...opts.env } : undefined,
	});
	return {
		stdout: res.stdout ?? "",
		stderr: res.stderr ?? "",
		exitCode: res.status ?? -1,
	};
}

/**
 * Async sibling of runCli for tests that serve HTTP from the vitest worker
 * while the child runs: spawnSync blocks this worker's event loop, so an
 * in-worker node:http server could never answer the child's fetch (spec 016
 * T8 deadlock).
 */
export async function runCliAsync(
	args: string[],
	opts?: { cwd?: string; env?: Record<string, string> },
): Promise<CliResult> {
	try {
		const { stdout, stderr } = await execFileAsync(
			process.execPath,
			[binPath, ...args],
			{
				cwd: opts?.cwd,
				env: opts?.env ? { ...process.env, ...opts.env } : undefined,
			},
		);
		return { stdout, stderr, exitCode: 0 };
	} catch (error) {
		const err = error as {
			code?: number | string;
			stdout?: string;
			stderr?: string;
		};
		return {
			stdout: err.stdout ?? "",
			stderr: err.stderr ?? "",
			exitCode: typeof err.code === "number" ? err.code : -1,
		};
	}
}

/** AC-9: on success paths stdout carries the report and stderr stays empty. */
export function expectSuccess(result: CliResult, expectedExitCode = 0): void {
	expect(result.stderr, "stderr must stay empty on success (AC-9)").toBe("");
	expect(result.exitCode).toBe(expectedExitCode);
}

export function makeTmpDir(): string {
	return fs.mkdtempSync(path.join(os.tmpdir(), "backend-doctor-e2e-"));
}

export function packageVersion(): string {
	const raw = fs.readFileSync(
		new URL("../../package.json", import.meta.url),
		"utf8",
	);
	const pkg = JSON.parse(raw) as { version?: string };
	expect(pkg.version).toBeDefined();
	return pkg.version as string;
}
