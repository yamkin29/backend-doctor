import fs from "node:fs";
import path from "node:path";

/**
 * Repo-internal rule-docs tooling (spec 017, constitution §3): the registry
 * is the source of truth for a rule's identity and classification, and these
 * helpers keep `docs/rules/` from drifting away from it.
 *
 * Not part of the shipped CLI surface — consumed by the maintainer runner
 * (`dist/scripts/rule-docs.js`) and by the test-suite drift gate.
 */

/** Canonical repo-relative root every rule doc must live under. */
export const CANONICAL_DOCS_ROOT = "docs/rules";

/**
 * The doc-relevant metadata both rule kinds carry. Structural (plain
 * `string`s) so tests can hand-roll it against temp trees.
 */
export interface RuleDocsMeta {
	readonly id: string;
	readonly category: string;
	readonly severity: string;
	readonly docs: string;
}

/**
 * Resolves a rule's declared `docs` path (repo-relative, canonical spelling
 * `docs/rules/…`) under the given docs root, so checks and scaffolding run
 * unchanged against the real tree or a temp tree.
 */
export function resolveDocPath(rule: RuleDocsMeta, docsDir: string): string {
	return path.join(docsDir, path.relative(CANONICAL_DOCS_ROOT, rule.docs));
}

interface ParsedDocMeta {
	heading?: string;
	category?: string;
	severity?: string;
}

function parseDocMeta(text: string): ParsedDocMeta {
	const meta: ParsedDocMeta = {};
	for (const line of text.split("\n")) {
		if (meta.heading === undefined && line.startsWith("# ")) {
			meta.heading = line.slice(2).trim();
		}
		const category = line.match(/^- \*\*Category:\*\* (.+)$/);
		if (category !== null && category[1] !== undefined) {
			meta.category = category[1].trim();
		}
		const severity = line.match(/^- \*\*Default severity:\*\* `([^`]+)`/);
		if (severity !== null && severity[1] !== undefined) {
			meta.severity = severity[1].trim();
		}
	}
	return meta;
}

/**
 * Spec 017 AC-8: returns one human-readable violation per problem (each
 * starting with the offending path); an empty array means the docs match the
 * registry. Violations: a `docs` path outside the canonical root, a missing
 * doc, a heading/Category/Default-severity line that disagrees with the
 * registry (or is absent), and orphan docs no registered rule declares.
 */
export function checkRuleDocs(
	rules: readonly RuleDocsMeta[],
	docsDir: string,
): string[] {
	const violations: string[] = [];
	const declared = new Set<string>();

	for (const rule of rules) {
		if (!rule.docs.startsWith(`${CANONICAL_DOCS_ROOT}/`)) {
			violations.push(
				`${rule.docs}: rule "${rule.id}" declares a doc outside ${CANONICAL_DOCS_ROOT}/`,
			);
			continue;
		}
		const docPath = resolveDocPath(rule, docsDir);
		declared.add(path.resolve(docPath));
		if (!fs.existsSync(docPath)) {
			violations.push(
				`${rule.docs}: no doc found for rule "${rule.id}" (expected at ${docPath})`,
			);
			continue;
		}
		const meta = parseDocMeta(fs.readFileSync(docPath, "utf8"));
		if (meta.heading !== rule.id) {
			violations.push(
				`${rule.docs}: heading "${meta.heading ?? ""}" does not match rule id "${rule.id}"`,
			);
		}
		if (meta.category === undefined) {
			violations.push(
				`${rule.docs}: no "- **Category:**" line (registry says "${rule.category}")`,
			);
		} else if (meta.category !== rule.category) {
			violations.push(
				`${rule.docs}: Category "${meta.category}" does not match registry category "${rule.category}"`,
			);
		}
		if (meta.severity === undefined) {
			violations.push(
				`${rule.docs}: no "- **Default severity:**" line (registry says "${rule.severity}")`,
			);
		} else if (meta.severity !== rule.severity) {
			violations.push(
				`${rule.docs}: Default severity "${meta.severity}" does not match registry severity "${rule.severity}"`,
			);
		}
	}

	// Orphan scan per plugin directory derived from the rule-id prefixes.
	const plugins = new Set(
		rules.map((rule) => rule.id.split("/")[0] ?? rule.id),
	);
	for (const plugin of plugins) {
		const pluginDir = path.join(docsDir, plugin);
		if (!fs.existsSync(pluginDir)) continue;
		for (const entry of fs.readdirSync(pluginDir)) {
			if (!entry.endsWith(".md")) continue;
			const filePath = path.join(pluginDir, entry);
			if (!declared.has(path.resolve(filePath))) {
				violations.push(
					`${filePath}: orphan doc — no registered rule declares it`,
				);
			}
		}
	}

	return violations;
}

/**
 * Spec 017 AC-9: the skeleton for a new rule doc, derived from registry
 * metadata. Registry-derived lines (heading, Category, Default severity) are
 * final; the prose sections carry loud TODO markers so an unfinished doc is
 * visible at a glance while already satisfying the drift check's metadata
 * contract.
 */
export function scaffoldRuleDocContent(rule: RuleDocsMeta): string {
	return `# ${rule.id}

TODO: one-sentence summary of what this rule flags.

- **Category:** ${rule.category}
- **Default severity:** \`${rule.severity}\`

## Problem

TODO: why this matters in backend services. Precision over recall
(constitution §2): also state what is deliberately NOT flagged.

## Bad

\`\`\`ts
// ❌ TODO: offending example
\`\`\`

## Good

\`\`\`ts
// ✅ TODO: corrected example
\`\`\`

## Configuration

\`\`\`ts
import { defineConfig } from "backend-doctor-cli";

export default defineConfig({
	rules: {
		// Escalate to a blocking error in CI:
		"${rule.id}": "error",
		// or silence it deliberately:
		// "${rule.id}": "off",
	},
});
\`\`\`
`;
}

export type ScaffoldResult =
	| { readonly ok: true; readonly path: string }
	| { readonly ok: false; readonly reason: "exists"; readonly path: string };

/**
 * Writes the skeleton at the rule's resolved doc path, creating parent
 * directories. An existing doc is never touched (atomic create-or-fail via
 * the `wx` flag); unexpected write errors propagate — no silent fallbacks
 * (constitution §8).
 */
export function scaffoldRuleDoc(
	rule: RuleDocsMeta,
	docsDir: string,
): ScaffoldResult {
	const docPath = resolveDocPath(rule, docsDir);
	fs.mkdirSync(path.dirname(docPath), { recursive: true });
	try {
		fs.writeFileSync(docPath, scaffoldRuleDocContent(rule), { flag: "wx" });
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
			throw error;
		}
		return { ok: false, reason: "exists", path: docPath };
	}
	return { ok: true, path: docPath };
}
