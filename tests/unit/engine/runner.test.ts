import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { ResolvedConfig } from "../../../src/config/types.js";
import type { DiagnosticCategory } from "../../../src/core/types.js";
import type {
	Node,
	ParserAdapter,
	SourceFileView,
} from "../../../src/engine/parser/types.js";
import {
	defineRule,
	type RuleDefinition,
} from "../../../src/engine/registry.js";
import { runRules, sortDiagnostics } from "../../../src/engine/runner.js";

/** Minimal in-memory view — enough for spy rules that report fixed positions. */
class FakeView implements SourceFileView {
	constructor(
		readonly filePath: string,
		private readonly text = "",
	) {}

	getRelativePathTo(target: string): string {
		return path.relative(target, this.filePath).split(path.sep).join("/");
	}

	forEachDescendant(): void {}

	getModuleSpecifiers(): string[] {
		return [];
	}

	getText(): string {
		return this.text;
	}
}

const fakeAdapter: ParserAdapter = {
	name: "fake",
	createProject: () => {
		throw new Error("not used in runner tests");
	},
	positionOf: () => ({ line: 7, column: 9 }),
};

function config(overrides: Partial<ResolvedConfig> = {}): ResolvedConfig {
	return {
		rules: {},
		categories: {},
		ignore: { files: [], rules: [] },
		source: { kind: "default", path: null },
		...overrides,
	};
}

function rule(
	id: string,
	create: RuleDefinition["create"],
	severity: "error" | "warn" = "warn",
	category: DiagnosticCategory = "Security",
): RuleDefinition {
	return defineRule({
		id,
		title: id,
		category,
		severity,
		docs: `docs/rules/${id}.md`,
		create,
	});
}

const scanRoot = path.join(os.tmpdir(), "backend-doctor-runner");
const file = new FakeView(path.join(scanRoot, "src", "index.ts"));

function run(
	rules: RuleDefinition[],
	cfg = config(),
	target = file,
): ReturnType<typeof runRules> {
	return runRules({
		file: target,
		rules,
		config: cfg,
		adapter: fakeAdapter,
		scanRoot,
	});
}

describe("runRules (AC-3/6/9)", () => {
	it("stamps rule, category, resolved severity, message and tags on findings", () => {
		const cfg = config({ rules: { "backend-doctor/a": "error" } });
		const { diagnostics } = run(
			[
				rule("backend-doctor/a", (ctx) => {
					ctx.report({ line: 3, column: 4, message: "boom" });
				}),
			],
			cfg,
		);

		expect(diagnostics).toHaveLength(1);
		expect(diagnostics[0]).toMatchObject({
			rule: "backend-doctor/a",
			category: "Security",
			severity: "error",
			message: "boom",
			tags: [],
			filePath: path.join(scanRoot, "src", "index.ts"),
			line: 3,
			column: 4,
		});
	});

	it("reports 1-based line/column and never exposes ids to rules (AC-4)", () => {
		const { diagnostics } = run([
			rule("backend-doctor/a", (ctx) => {
				ctx.report({ line: 2, column: 5, message: "first" });
				ctx.report({ line: 2, column: 5, message: "second" });
			}),
		]);

		expect(diagnostics).toHaveLength(2);
		const [first, second] = diagnostics;
		for (const d of [first, second]) {
			expect(d?.id).toMatch(
				/^src\/index\.ts::2:5::backend-doctor\/a::[0-9a-f]{8}$/,
			);
		}
		expect(first?.id).not.toBe(second?.id);
	});

	it("does not run rules that resolve to off (AC-9)", () => {
		const cfg = config({ rules: { "backend-doctor/off": "off" } });
		let invoked = false;
		const { diagnostics } = run(
			[
				rule("backend-doctor/off", () => {
					invoked = true;
				}),
			],
			cfg,
		);
		expect(invoked).toBe(false);
		expect(diagnostics).toEqual([]);
	});

	it("does not run rules listed in config.ignore.rules (AC-9)", () => {
		const cfg = config({
			ignore: { files: [], rules: ["backend-doctor/skip"] },
		});
		let invoked = false;
		const { diagnostics } = run(
			[
				rule("backend-doctor/skip", () => {
					invoked = true;
				}),
			],
			cfg,
		);
		expect(invoked).toBe(false);
		expect(diagnostics).toEqual([]);
	});

	it("keeps siblings running when a rule throws, emitting an internal diagnostic and a skippedChecks entry (AC-6)", () => {
		const calls: string[] = [];
		const throwing = rule("backend-doctor/boom", () => {
			throw new TypeError("cannot read property of undefined");
		});
		const healthy = rule("backend-doctor/ok", (ctx) => {
			calls.push("ok");
			ctx.report({ line: 5, column: 1, message: "fine" });
		});

		const { diagnostics, skippedChecks } = run([throwing, healthy]);

		expect(calls).toEqual(["ok"]);
		expect(diagnostics).toHaveLength(2);

		const internal = diagnostics.find((d) => d.rule === "backend-doctor/boom");
		expect(internal).toMatchObject({
			severity: "warn",
			tags: ["internal"],
			line: 1,
			column: 1,
		});
		expect(internal?.message).toContain("backend-doctor/boom");
		expect(internal?.message).toContain("cannot read property of undefined");

		const healthyDiagnostic = diagnostics.find(
			(d) => d.rule === "backend-doctor/ok",
		);
		expect(healthyDiagnostic?.message).toBe("fine");

		expect(skippedChecks).toEqual([
			{
				check: "backend-doctor/boom",
				reason: expect.stringContaining("src/index.ts"),
			},
		]);
	});

	it("discards partial findings of a crashed rule", () => {
		const flaky = rule("backend-doctor/flaky", (ctx) => {
			ctx.report({ line: 1, column: 1, message: "half-trusted" });
			throw new Error("crashed after reporting");
		});

		const { diagnostics } = run([flaky]);

		expect(diagnostics).toHaveLength(1);
		expect(diagnostics[0]?.tags).toEqual(["internal"]);
	});

	it("uses 1:1 as the position when a rule reports neither node nor position", () => {
		const { diagnostics } = run([
			rule("backend-doctor/a", (ctx) => {
				ctx.report({ message: "somewhere" });
			}),
		]);
		expect(diagnostics[0]?.line).toBe(1);
		expect(diagnostics[0]?.column).toBe(1);
	});

	it("asks the adapter for positions when a node is reported", () => {
		const stubNode = { getStart: () => 42 } as unknown as Node;
		const { diagnostics } = run([
			rule("backend-doctor/a", (ctx) => {
				ctx.report({
					node: stubNode,
					message: "node-based",
				});
			}),
		]);
		expect(diagnostics[0]?.line).toBe(7);
		expect(diagnostics[0]?.column).toBe(9);
	});
});

describe("sortDiagnostics (AC-10 ordering)", () => {
	it("sorts by relative file, line, column, rule id", () => {
		const base = {
			category: "Security" as DiagnosticCategory,
			severity: "warn" as const,
			tags: [],
		};
		const inRoot = (rel: string) => path.join(scanRoot, rel);
		const diagnostics = [
			{
				...base,
				id: "d",
				filePath: inRoot("src/b.ts"),
				line: 1,
				column: 1,
				rule: "backend-doctor/b",
				message: "",
			},
			{
				...base,
				id: "a",
				filePath: inRoot("src/a.ts"),
				line: 9,
				column: 1,
				rule: "backend-doctor/a",
				message: "",
			},
			{
				...base,
				id: "c",
				filePath: inRoot("src/a.ts"),
				line: 1,
				column: 1,
				rule: "backend-doctor/b",
				message: "",
			},
			{
				...base,
				id: "b",
				filePath: inRoot("src/a.ts"),
				line: 1,
				column: 1,
				rule: "backend-doctor/a",
				message: "",
			},
		];

		const sorted = sortDiagnostics(diagnostics, scanRoot);
		expect(sorted.map((d) => d.id)).toEqual(["b", "c", "a", "d"]);
	});

	it("is stable across repeated sorts", () => {
		const base = {
			category: "Security" as DiagnosticCategory,
			severity: "warn" as const,
			tags: [],
			filePath: path.join(scanRoot, "src/a.ts"),
			message: "",
		};
		const diagnostics = [
			{ ...base, id: "1", line: 1, column: 2, rule: "backend-doctor/a" },
			{ ...base, id: "2", line: 1, column: 1, rule: "backend-doctor/b" },
		];
		expect(sortDiagnostics(diagnostics, scanRoot)).toEqual(
			sortDiagnostics(diagnostics, scanRoot),
		);
	});
});
