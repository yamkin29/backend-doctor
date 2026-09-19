import { describe, expect, it } from "vitest";
import { createDiagnosticId } from "../../../src/engine/diagnostic-id.js";

describe("createDiagnosticId (AC-4)", () => {
	const args = {
		file: "src/index.ts",
		line: 12,
		column: 3,
		rule: "backend-doctor/no-eval",
		message: "Prefer safer alternatives instead of eval().",
	};

	it("builds the human-readable prefix plus an 8-char digest", () => {
		const id = createDiagnosticId(args);
		expect(id).toMatch(
			/^src\/index\.ts::12:3::backend-doctor\/no-eval::[0-9a-f]{8}$/,
		);
	});

	it("is stable across calls (constitution §1)", () => {
		expect(createDiagnosticId(args)).toBe(createDiagnosticId(args));
	});

	it("changes when the message changes", () => {
		expect(
			createDiagnosticId({ ...args, message: "Different message." }),
		).not.toBe(createDiagnosticId(args));
	});

	it("changes when the position changes", () => {
		expect(createDiagnosticId({ ...args, line: 13 })).not.toBe(
			createDiagnosticId(args),
		);
		expect(createDiagnosticId({ ...args, column: 4 })).not.toBe(
			createDiagnosticId(args),
		);
	});

	it("changes when the rule or file changes", () => {
		expect(
			createDiagnosticId({ ...args, rule: "backend-doctor/no-new-func" }),
		).not.toBe(createDiagnosticId(args));
		expect(createDiagnosticId({ ...args, file: "src/other.ts" })).not.toBe(
			createDiagnosticId(args),
		);
	});
});
