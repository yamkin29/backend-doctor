import path from "node:path";
import { describe, expect, it } from "vitest";
import {
	collectFiles,
	SUPPORTED_EXTENSIONS,
} from "../../../src/engine/collect.js";
import { TsMorphParserAdapter } from "../../../src/engine/parser/ts-morph-adapter.js";
import type { ParserAdapter } from "../../../src/engine/parser/types.js";
import {
	buildNestModelOrSkip,
	extractNestAppModel,
} from "../../../src/framework/nest/extract.js";

const FIXTURE_ROOT = path.resolve(import.meta.dirname, "../../fixtures/nest");
const APP_ROOT = path.join(FIXTURE_ROOT, "model-app");
const EXT_ROOT = path.join(FIXTURE_ROOT, "di-rules", "model-extensions");

/** Runs the real extractor over the committed fixture app. */
function extractModel(
	root = APP_ROOT,
	reverseFiles = false,
): ReturnType<typeof extractNestAppModel> {
	const paths = collectFiles({
		target: root,
		extensions: SUPPORTED_EXTENSIONS,
		excludes: [],
		ignoreGlobs: [],
	});
	const adapter = new TsMorphParserAdapter();
	const { files } = adapter.createProject(paths);
	return extractNestAppModel(
		reverseFiles ? [...files].reverse() : files,
		adapter,
	);
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
				global: false,
				hasUnresolved: false,
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
				global: false,
				hasUnresolved: true,
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
				global: false,
				hasUnresolved: true,
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
				global: false,
				hasUnresolved: true,
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
				injections: [],
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
				injections: [
					{
						name: "UsersService",
						forwardRef: false,
						line: 6,
						column: 14,
					},
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
				scope: null,
				injections: [],
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

describe("nest model: unresolved references (AC-5)", () => {
	it("records unreadable module metadata with positions and keeps readable siblings (AC-5)", () => {
		const { unresolved, modules } = extractModel();
		const dynamic = modules.find((m) => m.className === "DynamicModule");
		expect(dynamic?.imports).toEqual(["UsersService"]);
		expect(unresolved).toEqual([
			{
				filePath: path.join(APP_ROOT, "dynamic", "dynamic.module.ts"),
				line: 13,
				column: 14,
				reason: "spread element in providers array",
			},
			{
				filePath: path.join(APP_ROOT, "dynamic", "dynamic.module.ts"),
				line: 13,
				column: 24,
				reason:
					"object literal element in providers array without a readable class reference",
			},
			{
				filePath: path.join(APP_ROOT, "dynamic", "dynamic.module.ts"),
				line: 14,
				column: 2,
				reason: '"exports" is not a static array',
			},
			{
				filePath: path.join(APP_ROOT, "dynamic", "dynamic.module.ts"),
				line: 18,
				column: 9,
				reason: "@Module metadata is not a static object literal",
			},
			{
				filePath: path.join(APP_ROOT, "users", "users.module.ts"),
				line: 15,
				column: 3,
				reason:
					"object literal element in providers array without a readable class reference",
			},
		]);
	});
});

describe("nest model: DI extensions (spec 009 AC-1..5)", () => {
	it("captures scope, injections, @Global and hasUnresolved (AC-1..4)", () => {
		const model = extractModel(EXT_ROOT);
		expect(model.modules).toEqual([
			{
				filePath: path.join(EXT_ROOT, "app.module.ts"),
				className: "AppModule",
				line: 13,
				column: 1,
				imports: ["LegacyModule", "SharedModule"],
				providers: ["CurrentUserService"],
				controllers: ["ProfileController"],
				exports: [],
				global: true,
				hasUnresolved: true,
			},
			{
				filePath: path.join(EXT_ROOT, "legacy.module.ts"),
				className: "LegacyModule",
				line: 6,
				column: 1,
				imports: [],
				providers: ["LegacyService"],
				controllers: [],
				exports: ["LegacyService"],
				global: false,
				hasUnresolved: true,
			},
			{
				filePath: path.join(EXT_ROOT, "shared.module.ts"),
				className: "SharedModule",
				line: 6,
				column: 1,
				imports: [],
				providers: ["SharedService"],
				controllers: [],
				exports: [],
				global: false,
				hasUnresolved: false,
			},
		]);
		expect(model.providers).toEqual([
			{
				filePath: path.join(EXT_ROOT, "audit.service.ts"),
				className: "AuditService",
				line: 3,
				column: 1,
				scope: "singleton",
				injections: [
					{
						name: "ArchiveService",
						forwardRef: true,
						line: 6,
						column: 3,
					},
				],
			},
			{
				filePath: path.join(EXT_ROOT, "current-user.service.ts"),
				className: "CurrentUserService",
				line: 4,
				column: 1,
				scope: "request",
				injections: [
					{
						name: "LegacyService",
						forwardRef: false,
						line: 6,
						column: 14,
					},
				],
			},
			{
				filePath: path.join(EXT_ROOT, "legacy.service.ts"),
				className: "LegacyService",
				line: 3,
				column: 1,
				scope: null,
				injections: [],
			},
			{
				filePath: path.join(EXT_ROOT, "shared.module.ts"),
				className: "SharedService",
				line: 3,
				column: 1,
				scope: null,
				injections: [],
			},
		]);
	});

	it("excludes @Optional parameters and keeps the module key capture (AC-2, AC-5)", () => {
		const { controllers, modules } = extractModel(EXT_ROOT);
		expect(controllers).toEqual([
			{
				filePath: path.join(EXT_ROOT, "profile.controller.ts"),
				className: "ProfileController",
				line: 3,
				column: 1,
				route: "profile",
				handlers: [{ name: "me", verb: "get", path: null, line: 7, column: 2 }],
				injections: [],
			},
		]);
		const app = modules.find((m) => m.className === "AppModule");
		expect(app?.imports).toEqual(["LegacyModule", "SharedModule"]);
	});

	it("still records the unresolved entries that set hasUnresolved (AC-4)", () => {
		const { unresolved } = extractModel(EXT_ROOT);
		expect(unresolved).toEqual([
			{
				filePath: path.join(EXT_ROOT, "app.module.ts"),
				line: 16,
				column: 34,
				reason:
					"object literal element in providers array without a readable class reference",
			},
			{
				filePath: path.join(EXT_ROOT, "legacy.module.ts"),
				line: 7,
				column: 29,
				reason:
					"object literal element in providers array without a readable class reference",
			},
		]);
	});
});

describe("nest model: determinism and empty model (AC-8, AC-10)", () => {
	it("produces an all-empty model for an empty file set (AC-10)", () => {
		const adapter = new TsMorphParserAdapter();
		expect(extractNestAppModel([], adapter)).toEqual({
			modules: [],
			controllers: [],
			providers: [],
			dtos: [],
			unresolved: [],
		});
	});

	it("is independent of the input file order and stable across runs (AC-8)", () => {
		const sorted = extractModel();
		const reversed = extractModel(APP_ROOT, true);
		expect(reversed).toEqual(sorted);
	});
});

describe("nest model: crash isolation (AC-9)", () => {
	it("turns an extraction crash into a skippedChecks failure (AC-9)", () => {
		const realAdapter = new TsMorphParserAdapter();
		const paths = collectFiles({
			target: APP_ROOT,
			extensions: SUPPORTED_EXTENSIONS,
			excludes: [],
			ignoreGlobs: [],
		});
		const { files } = realAdapter.createProject(paths);
		const throwing: ParserAdapter = {
			name: "throwing",
			createProject: realAdapter.createProject.bind(realAdapter),
			positionOf: () => {
				throw new Error("boom");
			},
		};

		const { model, failure } = buildNestModelOrSkip(files, throwing);

		expect(model).toBeUndefined();
		expect(failure).toEqual({
			check: "nest-app-model",
			reason: expect.stringContaining("boom"),
		});
	});

	it("returns the model untouched when extraction succeeds", () => {
		const realAdapter = new TsMorphParserAdapter();
		const { model, failure } = buildNestModelOrSkip([], realAdapter);
		expect(failure).toBeUndefined();
		expect(model).toEqual({
			modules: [],
			controllers: [],
			providers: [],
			dtos: [],
			unresolved: [],
		});
	});
});
