import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	type InstallRoots,
	installCommand,
	installStatus,
	targetDirFor,
} from "../../../src/cli/commands/install.js";

/**
 * Spec 024 AC-1..AC-4, AC-6..AC-8 at the command-function level: roots are
 * injected over temp trees, so no test touches the real home or the real
 * package. stdout/stderr discipline and commander validation are covered
 * end-to-end in tests/e2e/install-command.test.ts.
 */

const SKILL_BODY =
	"---\nname: backend-doctor\n---\nScan after backend edits.\n";

function makeTmp(): string {
	return fs.mkdtempSync(path.join(os.tmpdir(), "backend-doctor-install-"));
}

function makeSkillSource(base: string): string {
	const sourceDir = path.join(base, "skills", "backend-doctor");
	fs.mkdirSync(sourceDir, { recursive: true });
	fs.writeFileSync(path.join(sourceDir, "SKILL.md"), SKILL_BODY);
	fs.writeFileSync(
		path.join(sourceDir, "REFERENCE.md"),
		"companion file travels with the folder\n",
	);
	return sourceDir;
}

function makeRoots(): InstallRoots {
	const base = makeTmp();
	const cwd = path.join(base, "project");
	const home = path.join(base, "home");
	fs.mkdirSync(cwd, { recursive: true });
	fs.mkdirSync(home, { recursive: true });
	return { cwd, home, sourceDir: makeSkillSource(base) };
}

interface Captured {
	stdout: string;
	stderr: string;
	restore: () => void;
}

function capture(): Captured {
	const stdout: string[] = [];
	const stderr: string[] = [];
	const spyOut = vi
		.spyOn(process.stdout, "write")
		.mockImplementation((chunk) => {
			stdout.push(String(chunk));
			return true;
		});
	const spyErr = vi
		.spyOn(process.stderr, "write")
		.mockImplementation((chunk) => {
			stderr.push(String(chunk));
			return true;
		});
	return {
		get stdout() {
			return stdout.join("");
		},
		get stderr() {
			return stderr.join("");
		},
		restore: () => {
			spyOut.mockRestore();
			spyErr.mockRestore();
		},
	};
}

/** Relative paths + contents of every file under root (missing root → []). */
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

afterEach(() => {
	vi.restoreAllMocks();
});

describe("targetDirFor (spec 024)", () => {
	it("computes project and global targets per agent convention", () => {
		expect(targetDirFor("claude-code", "project", "/p", "/h")).toBe(
			path.join("/p", ".claude", "skills", "backend-doctor"),
		);
		expect(targetDirFor("codex", "global", "/p", "/h")).toBe(
			path.join("/h", ".codex", "skills", "backend-doctor"),
		);
	});
});

describe("installStatus (spec 024)", () => {
	it("reports absent when the target does not exist", () => {
		const base = makeTmp();
		expect(installStatus(path.join(base, "src"), path.join(base, "tgt"))).toBe(
			"absent",
		);
	});

	it("reports up-to-date for identical folders and differs otherwise", () => {
		const base = makeTmp();
		const source = makeSkillSource(base);
		const target = path.join(base, "target");
		fs.cpSync(source, target, { recursive: true });
		expect(installStatus(source, target)).toBe("up to date");

		fs.writeFileSync(path.join(target, "SKILL.md"), "edited by the user\n");
		expect(installStatus(source, target)).toBe("differs");

		fs.writeFileSync(path.join(target, "EXTRA.md"), "stale file\n");
		fs.writeFileSync(path.join(target, "SKILL.md"), SKILL_BODY);
		expect(installStatus(source, target)).toBe("differs");
	});
});

describe("installCommand (spec 024)", () => {
	it("installs fresh into the project scope, whole folder (AC-1)", () => {
		const roots = makeRoots();
		const out = capture();
		try {
			const exit = installCommand({ agent: "claude-code" }, roots);
			expect(exit).toBe(0);
			const target = path.join(
				roots.cwd,
				".claude",
				"skills",
				"backend-doctor",
			);
			expect(fs.readFileSync(path.join(target, "SKILL.md"), "utf8")).toBe(
				SKILL_BODY,
			);
			expect(
				fs.readFileSync(path.join(target, "REFERENCE.md"), "utf8"),
			).toContain("companion file");
			expect(out.stdout).toContain(target);
		} finally {
			out.restore();
		}
	});

	it("reports up-to-date without writing on the second run (AC-2)", () => {
		const roots = makeRoots();
		installCommand({ agent: "claude-code" }, roots);
		const before = fingerprint(roots.cwd);
		const out = capture();
		try {
			const exit = installCommand({ agent: "claude-code" }, roots);
			expect(exit).toBe(0);
			expect(out.stdout).toContain("Up to date");
		} finally {
			out.restore();
		}
		expect(fingerprint(roots.cwd)).toEqual(before);
	});

	it("refuses drift loudly and --force replaces cleanly (AC-3)", () => {
		const roots = makeRoots();
		installCommand({ agent: "claude-code" }, roots);
		const target = path.join(
			roots.cwd,
			".claude",
			"skills",
			"backend-doctor",
			"SKILL.md",
		);
		fs.writeFileSync(target, "edited by the user\n");

		const refused = capture();
		try {
			const exit = installCommand({ agent: "claude-code" }, roots);
			expect(exit).toBe(2);
			expect(refused.stderr).toContain(path.dirname(target));
			expect(refused.stderr).toContain("--force");
			expect(refused.stdout).toBe("");
		} finally {
			refused.restore();
		}
		expect(fs.readFileSync(target, "utf8")).toBe("edited by the user\n");

		const forced = capture();
		try {
			const exit = installCommand({ agent: "claude-code", force: true }, roots);
			expect(exit).toBe(0);
			expect(fs.readFileSync(target, "utf8")).toBe(SKILL_BODY);
			// Clean replace: an extra target file does not survive --force.
			fs.writeFileSync(path.join(path.dirname(target), "STALE.md"), "x");
			const exit2 = installCommand(
				{ agent: "claude-code", force: true },
				roots,
			);
			expect(exit2).toBe(0);
			expect(fs.existsSync(path.join(path.dirname(target), "STALE.md"))).toBe(
				false,
			);
		} finally {
			forced.restore();
		}
	});

	it("detection report: statuses, no writes, deterministic (AC-4, AC-8)", () => {
		const roots = makeRoots();
		installCommand({ agent: "claude-code" }, roots);
		const before = [...fingerprint(roots.cwd), ...fingerprint(roots.home)];
		const first = capture();
		let firstOut = "";
		try {
			expect(installCommand({}, roots)).toBe(0);
			firstOut = first.stdout;
		} finally {
			first.restore();
		}
		expect(firstOut).toContain("Skill source:");
		expect(firstOut).toContain("up to date");
		expect(firstOut.match(/^claude-code/gm)?.length).toBe(2);
		expect(firstOut.match(/^codex/gm)?.length).toBe(2);

		const second = capture();
		try {
			expect(installCommand({}, roots)).toBe(0);
			expect(second.stdout).toBe(firstOut);
		} finally {
			second.restore();
		}
		expect([...fingerprint(roots.cwd), ...fingerprint(roots.home)]).toEqual(
			before,
		);
	});

	it("targets the injected home for the global scope (AC-6)", () => {
		const roots = makeRoots();
		const out = capture();
		try {
			const exit = installCommand({ agent: "codex", scope: "global" }, roots);
			expect(exit).toBe(0);
			expect(
				fs.existsSync(
					path.join(
						roots.home,
						".codex",
						"skills",
						"backend-doctor",
						"SKILL.md",
					),
				),
			).toBe(true);
			expect(fs.existsSync(path.join(roots.cwd, ".codex"))).toBe(false);
		} finally {
			out.restore();
		}
	});

	it("fails loud when the skill source is missing (AC-7)", () => {
		const roots = makeRoots();
		roots.sourceDir = path.join(roots.sourceDir, "..", "nowhere");
		const out = capture();
		try {
			const exit = installCommand({ agent: "claude-code" }, roots);
			expect(exit).toBe(2);
			expect(out.stderr).toContain("nowhere");
			expect(out.stdout).toBe("");
		} finally {
			out.restore();
		}
	});
});
