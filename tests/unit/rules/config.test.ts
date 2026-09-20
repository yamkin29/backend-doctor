import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { ResolvedConfig } from "../../../src/config/types.js";
import { defaultConfig } from "../../../src/config/types.js";
import type { Diagnostic, SkippedCheck } from "../../../src/core/types.js";
import {
	collectFiles,
	SUPPORTED_EXTENSIONS,
} from "../../../src/engine/collect.js";
import { TsMorphParserAdapter } from "../../../src/engine/parser/ts-morph-adapter.js";
import {
	type RunProjectRulesOptions,
	runProjectRules,
} from "../../../src/engine/project-rules.js";
import type {
	ProjectRuleDefinition,
	RuleDefinition,
} from "../../../src/engine/registry.js";
import { defineProjectRule, defineRule } from "../../../src/engine/registry.js";
import { runRules } from "../../../src/engine/runner.js";
import { envWithoutValidation } from "../../../src/rules/config/env-without-validation.js";
import { noCommittedEnv } from "../../../src/rules/config/no-committed-env.js";
import { noDirectProcessEnv } from "../../../src/rules/config/no-direct-process-env.js";

const FIXTURE_ROOT = path.resolve(import.meta.dirname, "../../fixtures/config");

const CONFIG_ENV_MESSAGE =
	"process.env is read directly in business code; route the value through your config module so defaults and validation live in one place.";

function unvalidatedMessage(count: number): string {
	return `Environment variables are read in ${count} place(s) but never validated; a missing or misspelled variable surfaces as a runtime failure. Parse the whole environment with a schema (zod, class-validator, envalid) in your config module.`;
}

/** Short fixture id → file rule under test (grows with each rule task). */
const rules: Record<string, RuleDefinition> = {
	"no-direct-process-env": noDirectProcessEnv,
};

interface FixtureOutcome {
	diagnostics: Diagnostic[];
	skippedChecks: SkippedCheck[];
}

/** Runs file rules over a fixture directory using the real parser adapter. */
function runOverFixture(
	ruleDefs: readonly RuleDefinition[],
	fixtureName: string,
	config: ResolvedConfig = defaultConfig(),
): FixtureOutcome {
	const target = path.join(FIXTURE_ROOT, fixtureName);
	const files = collectFiles({
		target,
		extensions: SUPPORTED_EXTENSIONS,
		excludes: [],
		ignoreGlobs: [],
	});
	const adapter = new TsMorphParserAdapter();
	const { files: views } = adapter.createProject(files);

	const outcome: FixtureOutcome = { diagnostics: [], skippedChecks: [] };
	for (const view of views) {
		const result = runRules({
			file: view,
			rules: ruleDefs,
			config,
			adapter,
			scanRoot: target,
			detectedFrameworks: [],
		});
		outcome.diagnostics.push(...result.diagnostics);
		outcome.skippedChecks.push(...result.skippedChecks);
	}
	return outcome;
}

/** Runs one file rule over a fixture directory (diagnostics only). */
function scanFixture(shortId: string, fixtureName: string): Diagnostic[] {
	const rule = rules[shortId];
	if (!rule) throw new Error(`no rule registered for "${shortId}"`);
	return runOverFixture([rule], fixtureName).diagnostics;
}

function summarize(diagnostics: Diagnostic[]) {
	return diagnostics.map((d) => ({
		file: path.relative(FIXTURE_ROOT, d.filePath),
		line: d.line,
		column: d.column,
		message: d.message,
		severity: d.severity,
		category: d.category,
	}));
}

describe("backend-doctor/no-direct-process-env (AC-1)", () => {
	it("flags direct env access in business files with exact diagnostics", () => {
		expect(
			summarize(
				scanFixture("no-direct-process-env", "no-direct-process-env/invalid"),
			),
		).toEqual([
			{
				file: path.join("no-direct-process-env", "invalid", "users.service.ts"),
				line: 3,
				column: 17,
				message: CONFIG_ENV_MESSAGE,
				severity: "warn",
				category: "Configuration",
			},
			{
				file: path.join("no-direct-process-env", "invalid", "users.service.ts"),
				line: 7,
				column: 10,
				message: CONFIG_ENV_MESSAGE,
				severity: "warn",
				category: "Configuration",
			},
		]);
	});

	it("stays silent on config-shaped, test-shaped and whole-env files", () => {
		expect(
			scanFixture("no-direct-process-env", "no-direct-process-env/valid"),
		).toEqual([]);
	});
});

/** Runs project rules over a multi-file fixture tree (graph.test.ts precedent). */
function runProjectOverFixture(
	ruleDefs: readonly ProjectRuleDefinition[],
	fixtureName: string,
	config: ResolvedConfig = defaultConfig(),
): FixtureOutcome {
	const target = path.join(FIXTURE_ROOT, fixtureName);
	const paths = collectFiles({
		target,
		extensions: SUPPORTED_EXTENSIONS,
		excludes: [],
		ignoreGlobs: [],
	});
	const adapter = new TsMorphParserAdapter();
	const { files } = adapter.createProject(paths);
	const options: RunProjectRulesOptions = {
		files,
		rules: ruleDefs,
		config,
		adapter,
		scanRoot: target,
		detectedFrameworks: [],
		packageRoot: target,
	};
	return runProjectRules(options);
}

/** Runs one project rule over a fixture tree (diagnostics only). */
function scanProjectFixture(
	rule: ProjectRuleDefinition,
	fixtureName: string,
): Diagnostic[] {
	return runProjectOverFixture([rule], fixtureName).diagnostics;
}

describe("backend-doctor/env-without-validation (AC-2)", () => {
	it("reports one diagnostic at the first env access with the read count", () => {
		expect(
			summarize(
				scanProjectFixture(
					envWithoutValidation,
					"env-without-validation/invalid",
				),
			),
		).toEqual([
			{
				file: path.join(
					"env-without-validation",
					"invalid",
					"config",
					"settings.ts",
				),
				line: 2,
				column: 15,
				message: unvalidatedMessage(3),
				severity: "warn",
				category: "Configuration",
			},
		]);
	});

	it("stays silent when any analyzed file imports a validation library", () => {
		expect(
			scanProjectFixture(
				envWithoutValidation,
				"env-without-validation/valid-validated",
			),
		).toEqual([]);
	});

	it("stays silent when nothing reads the environment", () => {
		expect(
			scanProjectFixture(
				envWithoutValidation,
				"env-without-validation/valid-no-env",
			),
		).toEqual([]);
	});
});

function committedEnvMessage(name: string): string {
	return `${name} exists at the package root and is not covered by .gitignore; dotenv files carry real credentials and end up committed by accident. Add it to .gitignore, rotate any credential it ever held, and keep a committed .env.example instead.`;
}

describe("backend-doctor/no-committed-env (AC-3)", () => {
	it("flags uncovered dotenv candidates at the package root", () => {
		expect(
			summarize(scanProjectFixture(noCommittedEnv, "no-committed-env/invalid")),
		).toEqual([
			{
				file: path.join("no-committed-env", "invalid", ".env"),
				line: 1,
				column: 1,
				message: committedEnvMessage(".env"),
				severity: "warn",
				category: "Security",
			},
			{
				file: path.join("no-committed-env", "invalid", ".env.local"),
				line: 1,
				column: 1,
				message: committedEnvMessage(".env.local"),
				severity: "warn",
				category: "Security",
			},
		]);
	});

	it("flags dotenv files when no .gitignore exists", () => {
		expect(
			summarize(
				scanProjectFixture(
					noCommittedEnv,
					"no-committed-env/invalid-no-gitignore",
				),
			),
		).toEqual([
			{
				file: path.join("no-committed-env", "invalid-no-gitignore", ".env"),
				line: 1,
				column: 1,
				message: committedEnvMessage(".env"),
				severity: "warn",
				category: "Security",
			},
		]);
	});

	it("stays silent when .gitignore covers the candidates", () => {
		expect(
			scanProjectFixture(noCommittedEnv, "no-committed-env/valid"),
		).toEqual([]);
	});
});

const boomFileRule = defineRule({
	id: "backend-doctor/test/boom-file",
	title: "Boom (file)",
	category: "Bugs",
	severity: "warn",
	docs: "docs/rules/backend-doctor/no-direct-process-env.md",
	create() {
		throw new Error("boom file");
	},
});

const boomProjectRule = defineProjectRule({
	id: "backend-doctor/test/boom-project",
	title: "Boom (project)",
	category: "Bugs",
	severity: "warn",
	docs: "docs/rules/backend-doctor/no-committed-env.md",
	analyze() {
		throw new Error("boom project");
	},
});

describe("config pack fail-soft + config matrix (AC-4, AC-5)", () => {
	it("isolates a crashing file rule and keeps pack findings (AC-4)", () => {
		const outcome = runOverFixture(
			[boomFileRule, noDirectProcessEnv],
			"no-direct-process-env/invalid",
		);
		const internal = outcome.diagnostics.find(
			(d) => d.rule === boomFileRule.id,
		);
		expect(internal?.tags).toEqual(["internal"]);
		expect(internal?.line).toBe(1);
		expect(internal?.column).toBe(1);
		expect(outcome.skippedChecks.map((entry) => entry.check)).toContain(
			boomFileRule.id,
		);
		expect(
			outcome.diagnostics.filter((d) => d.rule === noDirectProcessEnv.id),
		).toHaveLength(2);
	});

	it("isolates a crashing project rule and keeps pack findings (AC-4)", () => {
		const outcome = runProjectOverFixture(
			[boomProjectRule, noCommittedEnv],
			"no-committed-env/invalid",
		);
		const internal = outcome.diagnostics.find(
			(d) => d.rule === boomProjectRule.id,
		);
		expect(internal?.tags).toEqual(["internal"]);
		expect(outcome.skippedChecks.map((entry) => entry.check)).toContain(
			boomProjectRule.id,
		);
		expect(
			outcome.diagnostics.filter((d) => d.rule === noCommittedEnv.id),
		).toHaveLength(2);
	});

	it("silences a pack rule via ignore.rules and severity off (AC-5)", () => {
		const ignored = defaultConfig();
		ignored.ignore.rules.push(noDirectProcessEnv.id);
		expect(
			runOverFixture(
				[noDirectProcessEnv],
				"no-direct-process-env/invalid",
				ignored,
			).diagnostics,
		).toEqual([]);

		const off = defaultConfig();
		off.rules[noDirectProcessEnv.id] = "off";
		expect(
			runOverFixture([noDirectProcessEnv], "no-direct-process-env/invalid", off)
				.diagnostics,
		).toEqual([]);
	});

	it("escalates a pack rule to error via the standard matrix (AC-5)", () => {
		const escalated = defaultConfig();
		escalated.rules[noDirectProcessEnv.id] = "error";
		const diagnostics = runOverFixture(
			[noDirectProcessEnv],
			"no-direct-process-env/invalid",
			escalated,
		).diagnostics;
		expect(diagnostics.length).toBe(2);
		for (const diagnostic of diagnostics) {
			expect(diagnostic.severity).toBe("error");
		}
	});
});

const REPO_ROOT = path.resolve(import.meta.dirname, "../../..");

describe("config pack ships fixtures and docs (AC-8)", () => {
	it("every pack rule has valid/invalid fixtures and a rule doc", () => {
		for (const rule of [
			noDirectProcessEnv,
			envWithoutValidation,
			noCommittedEnv,
		]) {
			const shortId = rule.id.replace("backend-doctor/", "");
			const scenarios = fs.readdirSync(path.join(FIXTURE_ROOT, shortId));
			expect(
				scenarios.some((s) => s === "invalid"),
				`${shortId}: invalid fixtures`,
			).toBe(true);
			expect(
				scenarios.some((s) => s.startsWith("valid")),
				`${shortId}: valid fixtures`,
			).toBe(true);
			expect(fs.existsSync(path.join(REPO_ROOT, rule.docs)), rule.docs).toBe(
				true,
			);
		}
	});
});
