import path from "node:path";
import { describe, expect, it } from "vitest";
import {
	collectFiles,
	SUPPORTED_EXTENSIONS,
} from "../../../src/engine/collect.js";
import { TsMorphParserAdapter } from "../../../src/engine/parser/ts-morph-adapter.js";
import { extractNestAppModel } from "../../../src/framework/nest/extract.js";

const FIXTURE_ROOT = path.resolve(import.meta.dirname, "../../fixtures/nest");
const APP_ROOT = path.join(FIXTURE_ROOT, "model-app");

/** Runs the real extractor over the committed fixture app. */
function extractModel(): ReturnType<typeof extractNestAppModel> {
	const paths = collectFiles({
		target: APP_ROOT,
		extensions: SUPPORTED_EXTENSIONS,
		excludes: [],
		ignoreGlobs: [],
	});
	const adapter = new TsMorphParserAdapter();
	const { files } = adapter.createProject(paths);
	return extractNestAppModel(files, adapter);
}

describe("nest model: modules (AC-1, AC-6)", () => {
	it("extracts module entries with references as written (AC-1)", () => {
		const { modules } = extractModel();
		expect(modules).toEqual([
			{
				filePath: path.join(APP_ROOT, "app.module.ts"),
				className: "AppModule",
				line: 6,
				column: 1,
				imports: ["UsersModule"],
				providers: ["UsersService"],
				controllers: ["UsersController"],
				exports: [],
			},
			{
				filePath: path.join(APP_ROOT, "dynamic", "dynamic.module.ts"),
				className: "DynamicModule",
				line: 11,
				column: 1,
				imports: ["UsersService"],
				providers: [],
				controllers: [],
				exports: [],
			},
			{
				filePath: path.join(APP_ROOT, "dynamic", "dynamic.module.ts"),
				className: "LooseModule",
				line: 18,
				column: 1,
				imports: [],
				providers: [],
				controllers: [],
				exports: [],
			},
			{
				filePath: path.join(APP_ROOT, "users", "users.module.ts"),
				className: "UsersModule",
				line: 11,
				column: 1,
				imports: [],
				providers: ["UsersService", "UsersService"],
				controllers: [],
				exports: ["UsersService"],
			},
		]);
	});

	it("collects nothing from files without a @nestjs import (AC-6)", () => {
		const model = extractModel();
		const classNames = model.modules.map((m) => m.className);
		expect(classNames).not.toContain("PlainModule");
	});
});

describe("nest model: controllers (AC-2)", () => {
	it("extracts the route and verb-decorated handlers (AC-2)", () => {
		const { controllers } = extractModel();
		expect(controllers).toEqual([
			{
				filePath: path.join(APP_ROOT, "users", "health.controller.ts"),
				className: "HealthController",
				line: 3,
				column: 1,
				route: null,
				handlers: [
					{ name: "ping", verb: "all", path: null, line: 5, column: 2 },
				],
			},
			{
				filePath: path.join(APP_ROOT, "users", "users.controller.ts"),
				className: "UsersController",
				line: 4,
				column: 1,
				route: "users",
				handlers: [
					{ name: "list", verb: "get", path: null, line: 8, column: 2 },
					{ name: "one", verb: "get", path: ":id", line: 13, column: 2 },
					{ name: "create", verb: "post", path: null, line: 18, column: 2 },
				],
			},
		]);
	});
});

describe("nest model: providers (AC-3)", () => {
	it("extracts @Injectable classes as provider entries (AC-3)", () => {
		const { providers } = extractModel();
		expect(providers).toEqual([
			{
				filePath: path.join(APP_ROOT, "users", "users.service.ts"),
				className: "UsersService",
				line: 3,
				column: 1,
			},
		]);
	});
});

describe("nest model: dtos (AC-4)", () => {
	it("extracts suffix and decorator DTOs with the matching via (AC-4)", () => {
		const { dtos } = extractModel();
		expect(dtos).toEqual([
			{
				filePath: path.join(APP_ROOT, "users", "create-user.dto.ts"),
				className: "CreateUserDto",
				line: 1,
				column: 1,
				via: "suffix",
			},
			{
				filePath: path.join(APP_ROOT, "users", "user.dto.ts"),
				className: "UserFilter",
				line: 3,
				column: 1,
				via: "decorator",
			},
		]);
	});

	it("keeps non-DTO classes out (AC-4)", () => {
		const { dtos } = extractModel();
		const classNames = dtos.map((d) => d.className);
		expect(classNames).not.toContain("UserEntity");
		expect(classNames).not.toContain("UsersService");
	});
});
