import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { allProjectRules, allRules } from "../../src/engine/registry.js";
// Importing registers the product rules so the real-tree gate sees them all.
import "../../src/rules/index.js";
import {
	checkRuleDocs,
	type RuleDocsMeta,
	resolveDocPath,
	scaffoldRuleDoc,
	scaffoldRuleDocContent,
} from "../../src/rule-docs/index.js";

/**
 * Spec 017 AC-8: the constitution §3 drift gate. Every registered rule must
 * have a doc at its declared `docs` path whose heading, Category and Default
 * severity match the registry, and every committed doc must belong to a
 * registered rule.
 */

function makeMeta(overrides?: Partial<RuleDocsMeta>): RuleDocsMeta {
	return {
		id: "backend-doctor/no-eval",
		category: "Security",
		severity: "warn",
		docs: "docs/rules/backend-doctor/no-eval.md",
		...overrides,
	};
}

function validDoc(meta: RuleDocsMeta): string {
	return [
		`# ${meta.id}`,
		"",
		"Flags the thing it flags.",
		"",
		`- **Category:** ${meta.category}`,
		`- **Default severity:** \`${meta.severity}\``,
		"",
		"## Problem",
		"",
		"Why it matters.",
		"",
	].join("\n");
}

function makeDocsDir(): string {
	const docsDir = fs.mkdtempSync(path.join(os.tmpdir(), "rule-docs-"));
	fs.mkdirSync(path.join(docsDir, "backend-doctor"), { recursive: true });
	return docsDir;
}

function writeDoc(docsDir: string, meta: RuleDocsMeta, body: string): string {
	const filePath = resolveDocPath(meta, docsDir);
	fs.writeFileSync(filePath, body);
	return filePath;
}

describe("checkRuleDocs over the real tree (spec 017 AC-8, the CI gate)", () => {
	it("passes for every registered rule and its committed doc", () => {
		const violations = checkRuleDocs(
			[...allRules(), ...allProjectRules()],
			"docs/rules",
		);
		expect(violations).toEqual([]);
	});
});

describe("checkRuleDocs violations in a temp tree (spec 017 AC-8 red paths)", () => {
	it("names a rule whose doc is missing", () => {
		const docsDir = makeDocsDir();
		const meta = makeMeta({
			id: "backend-doctor/no-demo",
			docs: "docs/rules/backend-doctor/no-demo.md",
		});
		const violations = checkRuleDocs([meta], docsDir);
		expect(violations).toHaveLength(1);
		expect(violations[0]).toContain("docs/rules/backend-doctor/no-demo.md");
		expect(violations[0]).toContain("no doc found");
		expect(violations[0]).toContain("backend-doctor/no-demo");
	});

	it("names a heading that does not match the rule id", () => {
		const docsDir = makeDocsDir();
		const meta = makeMeta();
		writeDoc(docsDir, meta, validDoc({ ...meta, id: "backend-doctor/other" }));
		const violations = checkRuleDocs([meta], docsDir);
		expect(violations).toHaveLength(1);
		expect(violations[0]).toContain("heading");
		expect(violations[0]).toContain("backend-doctor/other");
	});

	it("names a Category line that does not match the registry", () => {
		const docsDir = makeDocsDir();
		const meta = makeMeta();
		writeDoc(docsDir, meta, validDoc({ ...meta, category: "Performance" }));
		const violations = checkRuleDocs([meta], docsDir);
		expect(violations).toHaveLength(1);
		expect(violations[0]).toContain("Category");
		expect(violations[0]).toContain("Performance");
		expect(violations[0]).toContain("Security");
	});

	it("names a Default severity line that does not match the registry", () => {
		const docsDir = makeDocsDir();
		const meta = makeMeta();
		writeDoc(docsDir, meta, validDoc({ ...meta, severity: "error" }));
		const violations = checkRuleDocs([meta], docsDir);
		expect(violations).toHaveLength(1);
		expect(violations[0]).toContain("severity");
		expect(violations[0]).toContain("error");
		expect(violations[0]).toContain("warn");
	});

	it("names a doc whose metadata lines are missing entirely", () => {
		const docsDir = makeDocsDir();
		const meta = makeMeta();
		writeDoc(docsDir, meta, `# ${meta.id}\n\nBare prose only.\n`);
		const violations = checkRuleDocs([meta], docsDir);
		expect(violations.some((v) => v.includes("Category"))).toBe(true);
		expect(violations.some((v) => v.includes("Default severity"))).toBe(true);
	});

	it("rejects a docs path outside the canonical docs/rules root", () => {
		const docsDir = makeDocsDir();
		const meta = makeMeta({ docs: "docs/my-rules/no-eval.md" });
		const violations = checkRuleDocs([meta], docsDir);
		expect(violations).toHaveLength(1);
		expect(violations[0]).toContain("docs/rules");
	});

	it("names committed docs that no registered rule declares", () => {
		const docsDir = makeDocsDir();
		const meta = makeMeta();
		writeDoc(docsDir, meta, validDoc(meta));
		fs.writeFileSync(
			path.join(docsDir, "backend-doctor", "extra-note.md"),
			"# stray\n",
		);
		const violations = checkRuleDocs([meta], docsDir);
		expect(violations).toHaveLength(1);
		expect(violations[0]).toContain("orphan");
		expect(violations[0]).toContain("extra-note.md");
	});

	it("passes a seeded consistent tree with no violations", () => {
		const docsDir = makeDocsDir();
		const meta = makeMeta();
		writeDoc(docsDir, meta, validDoc(meta));
		expect(checkRuleDocs([meta], docsDir)).toEqual([]);
	});
});

describe("scaffoldRuleDocContent (spec 017 AC-9)", () => {
	it("derives heading, category and severity from the registry metadata", () => {
		const meta = makeMeta();
		const content = scaffoldRuleDocContent(meta);
		expect(content).toContain(`# ${meta.id}`);
		expect(content).toContain(`- **Category:** ${meta.category}`);
		expect(content).toContain(`- **Default severity:** \`${meta.severity}\``);
	});

	it("marks the prose sections as explicit TODOs", () => {
		const content = scaffoldRuleDocContent(makeMeta());
		expect(content).toContain("TODO");
		expect(content).toContain("## Problem");
		expect(content).toContain("## Bad");
		expect(content).toContain("## Good");
		expect(content).toContain("## Configuration");
	});

	it("produces a doc that passes the drift check as written", () => {
		const meta = makeMeta();
		const docsDir = makeDocsDir();
		writeDoc(docsDir, meta, scaffoldRuleDocContent(meta));
		expect(checkRuleDocs([meta], docsDir)).toEqual([]);
	});
});

describe("scaffoldRuleDoc (spec 017 AC-9)", () => {
	it("creates the doc at the resolved path and reports created", () => {
		const docsDir = makeDocsDir();
		const meta = makeMeta({
			id: "backend-doctor/no-demo",
			docs: "docs/rules/backend-doctor/no-demo.md",
		});
		const result = scaffoldRuleDoc(meta, docsDir);
		expect(result.ok).toBe(true);
		const filePath = resolveDocPath(meta, docsDir);
		const content = fs.readFileSync(filePath, "utf8");
		expect(content).toContain("# backend-doctor/no-demo");
		expect(content).toContain("- **Category:** Security");
	});

	it("refuses to overwrite an existing doc and leaves it byte-identical", () => {
		const docsDir = makeDocsDir();
		const meta = makeMeta();
		const original = "hand written prose — do not touch\n";
		const filePath = writeDoc(docsDir, meta, original);
		const result = scaffoldRuleDoc(meta, docsDir);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.reason).toBe("exists");
			expect(result.path).toBe(filePath);
		}
		expect(fs.readFileSync(filePath, "utf8")).toBe(original);
	});
});
