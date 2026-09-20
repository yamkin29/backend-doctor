import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { defaultConfig } from "../../../src/config/types.js";
import type { Diagnostic } from "../../../src/core/types.js";
import { TsMorphParserAdapter } from "../../../src/engine/parser/ts-morph-adapter.js";
import {
	readPackageJsonSurface,
	runProjectRules,
} from "../../../src/engine/project-rules.js";
import {
	allProjectRules,
	clearRegisteredRules,
	defineProjectRule,
	type ProjectRuleDefinition,
	registerProjectRule,
} from "../../../src/engine/registry.js";

function spyProjectRule(
	id: string,
	state: { calls: string[]; throw?: boolean },
): ProjectRuleDefinition {
	return defineProjectRule({
		id,
		title: `Spy ${id}`,
		category: "Architecture",
		severity: "warn",
		docs: `docs/rules/${id}.md`,
		analyze(project) {
			state.calls.push(id);
			if (state.throw) throw new Error("boom");
			for (const file of project.files) {
				project.report({
					filePath: file.filePath,
					line: 3,
					column: 5,
					message: `finding of ${id}`,
				});
			}
		},
	});
}

function writeTempFile(relative: string, content: string): string {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "backend-doctor-proj-"));
	const filePath = path.join(root, relative);
	fs.mkdirSync(path.dirname(filePath), { recursive: true });
	fs.writeFileSync(filePath, content);
	return root;
}

function viewsOf(root: string) {
	const files: string[] = [];
	for (const entry of fs.readdirSync(root, { recursive: true })) {
		const absolute = path.join(root, entry.toString());
		if (absolute.endsWith(".ts")) files.push(absolute);
	}
	const adapter = new TsMorphParserAdapter();
	return { adapter, files: adapter.createProject(files.sort()).files };
}

function run(
	rules: ProjectRuleDefinition[],
	detectedFrameworks: string[] = [],
) {
	const root = writeTempFile("src/a.ts", "export const a = 1;\n");
	const { adapter, files } = viewsOf(root);
	return {
		root,
		outcome: runProjectRules({
			files,
			rules,
			config: defaultConfig(),
			adapter,
			scanRoot: root,
			detectedFrameworks,
			packageRoot: root,
		}),
	};
}

describe("project-rule registry", () => {
	beforeEach(() => {
		clearRegisteredRules();
	});

	it("registers project rules separately from file rules", () => {
		const state = { calls: [] as string[] };
		registerProjectRule(spyProjectRule("backend-doctor/graph/a", state));
		expect(allProjectRules().map((r) => r.id)).toEqual([
			"backend-doctor/graph/a",
		]);
	});

	it("rejects duplicate project rule ids loudly", () => {
		const state = { calls: [] as string[] };
		registerProjectRule(spyProjectRule("backend-doctor/graph/a", state));
		expect(() =>
			registerProjectRule(spyProjectRule("backend-doctor/graph/a", state)),
		).toThrow(/backend-doctor\/graph\/a/);
	});
});

describe("runProjectRules", () => {
	beforeEach(() => {
		clearRegisteredRules();
	});

	it("stamps findings with deterministic ids, severity and category", () => {
		const state = { calls: [] as string[] };
		const { outcome } = run([spyProjectRule("backend-doctor/graph/a", state)]);
		expect(state.calls).toEqual(["backend-doctor/graph/a"]);
		const diagnostics: Diagnostic[] = outcome.diagnostics;
		expect(diagnostics).toHaveLength(1);
		expect(diagnostics[0]?.rule).toBe("backend-doctor/graph/a");
		expect(diagnostics[0]?.line).toBe(3);
		expect(diagnostics[0]?.column).toBe(5);
		expect(diagnostics[0]?.severity).toBe("warn");
		expect(diagnostics[0]?.category).toBe("Architecture");
		expect(diagnostics[0]?.tags).toEqual([]);
		expect(diagnostics[0]?.filePath.endsWith(path.join("src", "a.ts"))).toBe(
			true,
		);
		expect(diagnostics[0]?.id).toContain("src/a.ts::3:5::");
	});

	it("applies the pack gate for project rules", () => {
		const state = { calls: [] as string[] };
		const rule = spyProjectRule("backend-doctor/graph/a", state);
		run([{ ...rule, frameworks: ["prisma"] }], []);
		expect(state.calls).toEqual([]);
	});

	it("honors ignore.rules and severity off", () => {
		const state = { calls: [] as string[] };
		const rule = spyProjectRule("backend-doctor/graph/a", state);
		const root = writeTempFile("src/a.ts", "export const a = 1;\n");
		const { adapter, files } = viewsOf(root);
		const config = defaultConfig();
		config.ignore.rules.push("backend-doctor/graph/a");
		const ignored = runProjectRules({
			files,
			rules: [rule],
			config,
			adapter,
			scanRoot: root,
			detectedFrameworks: [],
			packageRoot: root,
		});
		expect(ignored.diagnostics).toEqual([]);

		const off = defaultConfig();
		off.rules["backend-doctor/graph/a"] = "off";
		const silenced = runProjectRules({
			files,
			rules: [rule],
			config: off,
			adapter,
			scanRoot: root,
			detectedFrameworks: [],
			packageRoot: root,
		});
		expect(silenced.diagnostics).toEqual([]);
		expect(state.calls).toEqual([]);
	});

	it("escalates severity via config", () => {
		const state = { calls: [] as string[] };
		const rule = spyProjectRule("backend-doctor/graph/a", state);
		const root = writeTempFile("src/a.ts", "export const a = 1;\n");
		const { adapter, files } = viewsOf(root);
		const config = defaultConfig();
		config.rules["backend-doctor/graph/a"] = "error";
		const escalated = runProjectRules({
			files,
			rules: [rule],
			config,
			adapter,
			scanRoot: root,
			detectedFrameworks: [],
			packageRoot: root,
		});
		expect(escalated.diagnostics[0]?.severity).toBe("error");
	});

	it("isolates a throwing analyze and keeps sibling findings (AC-5)", () => {
		const state = { calls: [] as string[], throw: true };
		const boom = spyProjectRule("backend-doctor/graph/boom", state);
		const healthy = spyProjectRule("backend-doctor/graph/ok", {
			calls: [],
		});
		const { outcome } = run([boom, healthy]);
		const internal = outcome.diagnostics.find(
			(d) => d.rule === "backend-doctor/graph/boom",
		);
		expect(internal?.tags).toEqual(["internal"]);
		expect(internal?.line).toBe(1);
		expect(internal?.column).toBe(1);
		expect(internal?.message).toContain("boom");
		expect(
			outcome.diagnostics.some(
				(d) => d.rule === "backend-doctor/graph/ok" && d.tags.length === 0,
			),
		).toBe(true);
		expect(outcome.skippedChecks).toEqual([
			{
				check: "backend-doctor/graph/boom",
				reason: expect.stringContaining("project:"),
			},
		]);
	});
});

describe("readPackageJsonSurface", () => {
	it("reads dependency keys and scripts strings", () => {
		const root = writeTempFile(
			"package.json",
			JSON.stringify({
				name: "app",
				scripts: { start: "node dist/main.js", lint: "biome check ." },
				dependencies: { express: "^4.0.0", "@prisma/client": "^5.0.0" },
				devDependencies: { vitest: "^3.0.0" },
			}),
		);
		const surface = readPackageJsonSurface(root);
		expect(surface.dependencies).toEqual(["@prisma/client", "express"]);
		expect(surface.scripts).toEqual(["node dist/main.js", "biome check ."]);
		expect(surface.main).toBeUndefined();
		expect(surface.failure).toBeUndefined();
	});

	it("treats a missing package.json as an empty surface", () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "backend-doctor-pj-"));
		const surface = readPackageJsonSurface(root);
		expect(surface.dependencies).toEqual([]);
		expect(surface.scripts).toEqual([]);
		expect(surface.failure).toBeUndefined();
	});

	it("reports an invalid package.json instead of failing", () => {
		const root = writeTempFile("package.json", "{ not json");
		const surface = readPackageJsonSurface(root);
		expect(surface.dependencies).toEqual([]);
		expect(surface.failure?.check).toBe("package-surface");
	});
});
