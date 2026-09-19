import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect } from "vitest";

const binPath = path.resolve(
	fileURLToPath(import.meta.url),
	"../../../dist/bin/backend-doctor.js",
);

export interface CliResult {
	stdout: string;
	stderr: string;
	exitCode: number;
}

export function runCli(args: string[], opts?: { cwd?: string }): CliResult {
	const res = spawnSync(process.execPath, [binPath, ...args], {
		encoding: "utf8",
		cwd: opts?.cwd,
	});
	return {
		stdout: res.stdout ?? "",
		stderr: res.stderr ?? "",
		exitCode: res.status ?? -1,
	};
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
