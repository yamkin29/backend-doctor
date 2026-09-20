import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { TsMorphParserAdapter } from "../../../src/engine/parser/ts-morph-adapter.js";
import { Node } from "../../../src/engine/parser/types.js";
import {
	findModuleApiCalls,
	type ModuleApiCallOptions,
} from "../../../src/rules/shared/module-api-calls.js";

/** Parses one in-memory source through the real adapter. */
function viewOf(source: string) {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "backend-doctor-mac-"));
	const file = path.join(dir, "sample.ts");
	fs.writeFileSync(file, source);
	const adapter = new TsMorphParserAdapter();
	const { files } = adapter.createProject([file]);
	const view = files[0];
	if (!view) throw new Error("adapter returned no file view");
	return view;
}

function callTexts(
	file: Parameters<typeof findModuleApiCalls>[0],
	opts: ModuleApiCallOptions,
) {
	return findModuleApiCalls(file, opts).map(({ call }) => call.getText());
}

describe("findModuleApiCalls — gate and scope options (spec 007 T1)", () => {
	const TOP_LEVEL_MERGE = "const result = merge(left, right);\n";

	it("without specifiers there is no module gate, even at module top level", () => {
		const calls = callTexts(viewOf(TOP_LEVEL_MERGE), {
			names: ["merge"],
			insideFunctionBodies: false,
		});
		expect(calls).toEqual(["merge(left, right)"]);
	});

	it("insideFunctionBodies defaults to true and skips module top level", () => {
		const view = viewOf(TOP_LEVEL_MERGE);
		expect(callTexts(view, { names: ["merge"] })).toEqual([]);
		expect(
			callTexts(view, { names: ["merge"], insideFunctionBodies: true }),
		).toEqual([]);
		expect(
			callTexts(view, { names: ["merge"], insideFunctionBodies: false }),
		).toEqual(["merge(left, right)"]);
	});

	it("the specifier gate still filters when given", () => {
		const source = [
			'import { exec } from "node:util";',
			"export function run(cmd: string): void {",
			"\texec(cmd);",
			"}",
		].join("\n");
		const view = viewOf(source);
		expect(
			callTexts(view, {
				specifiers: ["node:child_process"],
				names: ["exec"],
				insideFunctionBodies: false,
			}),
		).toEqual([]);
		expect(
			callTexts(view, {
				specifiers: ["node:util", "util"],
				names: ["exec"],
				insideFunctionBodies: false,
			}),
		).toEqual(["exec(cmd)"]);
	});

	it("property-form calls and the accept predicate work at top level", () => {
		const source = [
			'import cp from "node:child_process";',
			'cp.exec("ls " + user);',
			'cp.exec("ls -la");',
		].join("\n");
		const calls = callTexts(viewOf(source), {
			specifiers: ["child_process", "node:child_process"],
			names: ["exec"],
			accept: (call) => {
				const first = call.getArguments()[0];
				return first === undefined || !Node.isStringLiteral(first);
			},
			insideFunctionBodies: false,
		});
		expect(calls).toEqual(['cp.exec("ls " + user)']);
	});
});
