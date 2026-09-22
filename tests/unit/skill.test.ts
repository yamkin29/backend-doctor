import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Spec 017 AC-6: the agent skill must stay truthful to the CLI it teaches.
 * The guard pins the frontmatter, validates every shown invocation against an
 * explicit allowlist of the real surface (src/cli/run.ts — update it when the
 * CLI grows), and pins the adopted primary command and doc conventions.
 */

const skillPath = path.resolve(
	import.meta.dirname,
	"../../skills/backend-doctor/SKILL.md",
);

const COMMANDS = new Set(["scan", "rules", "init", "ci"]);

const SUBCOMMANDS: Record<string, Set<string>> = {
	scan: new Set(),
	rules: new Set(["list", "explain"]),
	init: new Set(),
	ci: new Set(["install", "report"]),
};

// Mirror of the flags each command accepts today.
const ALLOWED_FLAGS: Record<string, Set<string>> = {
	scan: new Set([
		"--format",
		"--ignore",
		"--scope",
		"--base",
		"--file",
		"--config",
		"--dump-config",
	]),
	rules: new Set([]),
	init: new Set([]),
	ci: new Set([
		"--force",
		"--action-ref",
		"--report",
		"--blocking",
		"--event",
		"--no-comment",
		"--no-review-comments",
		"--no-commit-status",
		"--max-review-comments",
		"--dry-run",
	]),
};

function readSkill(): string {
	return fs.readFileSync(skillPath, "utf8");
}

/** Lines inside non-TS fenced code blocks that look like CLI invocations. */
function invocations(content: string): string[] {
	const found: string[] = [];
	let current: string[] | null = null;
	let language = "";
	for (const line of content.split("\n")) {
		if (line.startsWith("```")) {
			if (current === null) {
				language = line.slice(3).trim();
				current = [];
			} else {
				if (language !== "ts") {
					found.push(...current);
				}
				current = null;
			}
			continue;
		}
		if (current !== null) current.push(line);
	}
	return found
		.map((line) => line.trim())
		.filter(
			(line) =>
				line.startsWith("npx backend-doctor-cli@latest ") ||
				line.startsWith("backend-doctor "),
		);
}

describe("skills/backend-doctor/SKILL.md (spec 017 AC-6)", () => {
	it("exists with name/description frontmatter", () => {
		const content = readSkill();
		expect(content.startsWith("---\n")).toBe(true);
		const end = content.indexOf("\n---", 4);
		expect(end).toBeGreaterThan(0);
		const frontmatter = content.slice(4, end);
		expect(frontmatter).toMatch(/^name: backend-doctor$/m);
		expect(frontmatter).toMatch(/^description: \S+/m);
	});

	it("shows only real commands, subcommands and flags", () => {
		const shown = invocations(readSkill());
		expect(shown.length).toBeGreaterThanOrEqual(3);

		for (const invocation of shown) {
			const rest = invocation
				.replace(/^npx backend-doctor-cli@latest /, "")
				.replace(/^backend-doctor /, "");
			const tokens = rest.split(/\s+/);
			const command = tokens[0] ?? "";
			expect(COMMANDS.has(command), `unknown command in: ${invocation}`).toBe(
				true,
			);

			const allowedFlags = ALLOWED_FLAGS[command] ?? new Set();
			const allowedSubcommands = SUBCOMMANDS[command] ?? new Set();
			for (const [index, token] of tokens.entries()) {
				if (index === 0) continue;
				if (token.startsWith("-")) {
					expect(
						allowedFlags.has(token),
						`unknown flag in: ${invocation}`,
					).toBe(true);
					continue;
				}
				if (index === 1 && allowedSubcommands.size > 0) {
					expect(
						allowedSubcommands.has(token),
						`unknown subcommand in: ${invocation}`,
					).toBe(true);
				}
				// Any further non-flag token is a positional argument (a rule
				// id, a path) — shape-checked by the CLI itself.
			}
		}
	});

	it("teaches the adopted changed-scope jsonl flow first", () => {
		const content = readSkill();
		expect(content).toContain(
			"npx backend-doctor-cli@latest scan --scope changed --format jsonl",
		);
		expect(content.indexOf("scan --scope changed")).toBeLessThan(
			content.indexOf("scan --format jsonl"),
		);
	});

	it("documents the exit-code contract and the rule-doc convention", () => {
		const content = readSkill();
		expect(content).toContain("Exit codes");
		expect(content).toContain("`0`");
		expect(content).toContain("`1`");
		expect(content).toContain("`2`");
		expect(content).toContain("docs/rules/backend-doctor/");
		expect(content).toContain("`severity`");
	});
});
