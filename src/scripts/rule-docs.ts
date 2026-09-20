import path from "node:path";
import process from "node:process";
import { allProjectRules, allRules } from "../engine/registry.js";
import { checkRuleDocs, scaffoldRuleDoc } from "../rule-docs/index.js";
// Importing registers the product rules the tooling operates on.
import "../rules/index.js";

/**
 * Maintainer tooling for rule docs (spec 017) — built to
 * `dist/scripts/rule-docs.js` and run from the repository root:
 *
 *   node dist/scripts/rule-docs.js --check
 *   node dist/scripts/rule-docs.js --scaffold <rule-id>
 *
 * Exit codes are maintainer-tool semantics, not the CLI contract:
 * 0 ok, 1 check violations found, 2 usage or unknown rule id.
 */

function usage(): string {
	return "usage: node dist/scripts/rule-docs.js --check | --scaffold <rule-id>\n";
}

const args = process.argv.slice(2);
const docsDir = path.resolve("docs/rules");
const rules = [...allRules(), ...allProjectRules()];

if (args[0] === "--check") {
	if (args.length !== 1) {
		process.stderr.write(usage());
		process.exitCode = 2;
	} else {
		const violations = checkRuleDocs(rules, docsDir);
		if (violations.length === 0) {
			process.stdout.write(`rule docs: ok (${rules.length} rules, no drift)\n`);
			process.exitCode = 0;
		} else {
			for (const violation of violations) {
				process.stdout.write(`${violation}\n`);
			}
			process.stdout.write(`\n${violations.length} violation(s)\n`);
			process.exitCode = 1;
		}
	}
} else if (args[0] === "--scaffold") {
	const id = args[1];
	if (id === undefined || args.length !== 2) {
		process.stderr.write(usage());
		process.exitCode = 2;
	} else {
		const rule = rules.find((candidate) => candidate.id === id);
		if (rule === undefined) {
			process.stderr.write(`Unknown rule id: ${id}\n`);
			process.stderr.write(
				'Rule ids look like "backend-doctor/<kebab-name>"; see src/rules/index.ts.\n',
			);
			process.exitCode = 2;
		} else {
			const result = scaffoldRuleDoc(rule, docsDir);
			if (result.ok) {
				process.stdout.write(`Created ${result.path}\n`);
				process.exitCode = 0;
			} else {
				process.stderr.write(
					`Doc already exists, not overwriting: ${result.path}\n`,
				);
				process.exitCode = 2;
			}
		}
	}
} else {
	process.stderr.write(usage());
	process.exitCode = 2;
}
