import { describe, expect, it } from "vitest";
import {
	coverageLines,
	groupIssues,
	safeText,
	scoreReport,
} from "../../../src/cli/console/model.js";
import { diagnostic, report } from "../../helpers/console.js";

describe("console model (spec 028)", () => {
	it("groups by category, rule and effective severity without losing occurrence order", () => {
		const items = [
			diagnostic(),
			diagnostic({ id: "b", line: 9 }),
			diagnostic({ id: "c", severity: "error" }),
			diagnostic({
				id: "d",
				rule: "backend-doctor/no-floating-promises",
				category: "Correctness",
			}),
		];
		const before = structuredClone(items);
		const groups = groupIssues(items);
		expect(
			groups.map((g) => [
				g.category,
				g.rule,
				g.severity,
				g.diagnostics.map((d) => d.id),
			]),
		).toEqual([
			["Correctness", "backend-doctor/no-floating-promises", "warn", ["d"]],
			["Security", "backend-doctor/no-eval", "error", ["c"]],
			["Security", "backend-doctor/no-eval", "warn", ["a", "b"]],
		]);
		expect(items).toEqual(before);
	});
	it.each([
		[0, 0, 100, "Good"],
		[1, 0, 90, "Good"],
		[0, 6, 88, "Needs attention"],
		[3, 0, 70, "Needs attention"],
		[3, 1, 68, "Critical"],
		[11, 0, 0, "Critical"],
	])(
		"scores %i error groups and %i warning groups",
		(errors, warnings, value, label) => {
			const items = Array.from(
				{ length: Number(errors) + Number(warnings) },
				(_, i) =>
					diagnostic({
						rule: `backend-doctor/r${i}`,
						severity: i < Number(errors) ? "error" : "warn",
					}),
			);
			expect(scoreReport(report({ diagnostics: items }))).toEqual({
				value,
				label,
			});
		},
	);
	it("counts groups rather than repeated occurrences", () => {
		expect(
			scoreReport(
				report({
					diagnostics: [diagnostic(), diagnostic({ id: "b", line: 9 })],
				}),
			),
		).toEqual({ value: 98, label: "Good" });
	});
	it("makes partial, skipped and zero coverage score limitations explicit", () => {
		const doc = report();
		expect(scoreReport({ ...doc, mode: "files" })).toEqual({
			reason: expect.stringContaining("partial"),
		});
		const p = doc.projects[0];
		if (!p) throw new Error("Missing fixture project");
		expect(
			scoreReport({
				...doc,
				projects: [
					{ ...p, skippedChecks: [{ check: "parse", reason: "bad file" }] },
				],
			}),
		).toEqual({ reason: expect.stringContaining("skipped") });
		expect(
			scoreReport({ ...doc, projects: [{ ...p, analyzedFileCount: 0 }] }),
		).toEqual({ reason: expect.stringContaining("no supported") });
		expect(scoreReport({ ...doc, projects: [] })).toEqual({
			reason: expect.stringContaining("no supported"),
		});
	});
	it("keeps coverage and each skip visible when no findings exist", () => {
		const doc = report({
			diagnostics: [],
			projects: [
				{
					packageRoot: "/project",
					frameworks: [],
					analyzedFiles: [],
					analyzedFileCount: 0,
					complete: true,
					skippedChecks: [
						{ check: "read", reason: "broken.ts" },
						{ check: "graph", reason: "incomplete" },
					],
				},
			],
		});
		const text = coverageLines(doc).join("\n");
		expect(text).toContain("0 supported TypeScript files");
		expect(text).toContain("read: broken.ts");
		expect(text).toContain("graph: incomplete");
	});
	it("escapes ANSI, C1 and other control characters while retaining line breaks", () => {
		expect(safeText("a\u001b[31mb\u009bc\u0000\r\n\tx")).toBe(
			"a\\u001b[31mb\\u009bc\\u0000\\u000d\n    x",
		);
	});
	it("shows introduced scope and unverified baseline candidates in coverage", () => {
		const doc = report({ mode: "introduced" });
		const project = doc.projects[0];
		if (!project) throw new Error("Missing fixture project");
		project.complete = false;
		project.skippedChecks.push({
			check: "baseline-comparison",
			reason: "a.ts: unverified candidates, not proven introduced",
		});
		expect(coverageLines(doc).join("\n")).toContain("Scope: introduced");
		expect(coverageLines(doc).join("\n")).toContain("unverified candidates");
		expect(scoreReport(doc)).toEqual({ reason: "partial scan scope" });
	});
});
