import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { runCli } from "./helpers.js";

/**
 * Spec 024 AC-1..AC-6 through the built bin. Each test isolates both the
 * working directory and HOME so project and global scopes never touch the
 * real filesystem.
 */

const repoRoot = path.resolve(fileURLToPath(import.meta.url), "../../..");
const shippedSkill = path.join(
	repoRoot,
	"skills",
	"backend-doctor",
	"SKILL.md",
);

function makeTmp(): string {
	return fs.mkdtempSync(path.join(os.tmpdir(), "backend-doctor-install-e2e-"));
}

function fingerprint(root: string): string[] {
	const out: string[] = [];
	const walk = (dir: string, rel: string): void => {
		for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
			const child = path.join(dir, entry.name);
			const relNext = rel ? `${rel}/${entry.name}` : entry.name;
			if (entry.isDirectory()) {
				walk(child, relNext);
			} else {
				out.push(`${relNext}:${fs.readFileSync(child, "utf8")}`);
			}
		}
	};
	if (fs.existsSync(root)) {
		walk(root, "");
	}
	return out.sort();
}

describe("backend-doctor install (spec 024)", () => {
	it("creates the skill in the project scope, byte-identical to the shipped one (AC-1)", {
		timeout: 15000,
	}, () => {
		const cwd = makeTmp();
		const result = runCli(["install", "--agent", "claude-code"], {
			cwd,
		});
		expect(result.exitCode, result.stderr).toBe(0);
		const installed = path.join(
			cwd,
			".claude",
			"skills",
			"backend-doctor",
			"SKILL.md",
		);
		expect(fs.readFileSync(installed, "utf8")).toBe(
			fs.readFileSync(shippedSkill, "utf8"),
		);
		expect(result.stdout).toContain(
			path.join(cwd, ".claude", "skills", "backend-doctor"),
		);
	});

	it("reports up-to-date on the second run (AC-2)", { timeout: 15000 }, () => {
		const cwd = makeTmp();
		runCli(["install", "--agent", "claude-code"], { cwd });
		const result = runCli(["install", "--agent", "claude-code"], {
			cwd,
		});
		expect(result.exitCode, result.stderr).toBe(0);
		expect(result.stdout).toContain("Up to date");
	});

	it("refuses drift on stdout-clean exit 2 and --force replaces (AC-3)", {
		timeout: 15000,
	}, () => {
		const cwd = makeTmp();
		const skillDir = path.join(cwd, ".claude", "skills", "backend-doctor");
		runCli(["install", "--agent", "claude-code"], { cwd });
		fs.writeFileSync(path.join(skillDir, "SKILL.md"), "user edit\n");

		const refused = runCli(["install", "--agent", "claude-code"], {
			cwd,
		});
		expect(refused.exitCode).toBe(2);
		expect(refused.stdout).toBe("");
		expect(refused.stderr).toContain(skillDir);
		expect(refused.stderr).toContain("--force");
		expect(fs.readFileSync(path.join(skillDir, "SKILL.md"), "utf8")).toBe(
			"user edit\n",
		);

		const forced = runCli(["install", "--agent", "claude-code", "--force"], {
			cwd,
		});
		expect(forced.exitCode, forced.stderr).toBe(0);
		expect(fs.readFileSync(path.join(skillDir, "SKILL.md"), "utf8")).toBe(
			fs.readFileSync(shippedSkill, "utf8"),
		);
	});

	it("detection report: deterministic, zero writes (AC-4, AC-8)", {
		timeout: 15000,
	}, () => {
		const cwd = makeTmp();
		const home = makeTmp();
		const env = { HOME: home };
		const before = [...fingerprint(cwd), ...fingerprint(home)];
		const first = runCli(["install"], { cwd, env });
		expect(first.exitCode, first.stderr).toBe(0);
		expect(first.stdout).toContain("Skill source:");
		const second = runCli(["install"], { cwd, env });
		expect(second.stdout).toBe(first.stdout);
		expect([...fingerprint(cwd), ...fingerprint(home)]).toEqual(before);
	});

	it("rejects an unknown agent with the choices on stderr (AC-5)", {
		timeout: 15000,
	}, () => {
		const cwd = makeTmp();
		const result = runCli(["install", "--agent", "nope"], { cwd });
		expect(result.exitCode).toBe(2);
		expect(result.stdout).toBe("");
		expect(result.stderr).toContain("claude-code");
		expect(result.stderr).toContain("codex");
	});

	it("global scope targets the isolated HOME, not the cwd (AC-6)", {
		timeout: 15000,
	}, () => {
		const cwd = makeTmp();
		const home = makeTmp();
		const result = runCli(
			["install", "--agent", "codex", "--scope", "global"],
			{ cwd, env: { HOME: home } },
		);
		expect(result.exitCode, result.stderr).toBe(0);
		expect(
			fs.existsSync(
				path.join(home, ".codex", "skills", "backend-doctor", "SKILL.md"),
			),
		).toBe(true);
		expect(fs.existsSync(path.join(cwd, ".codex"))).toBe(false);
	});
});
