import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { defaultConfig } from "../../../src/config/types.js";
import type { Diagnostic } from "../../../src/core/types.js";
import {
	collectFiles,
	SUPPORTED_EXTENSIONS,
} from "../../../src/engine/collect.js";
import { TsMorphParserAdapter } from "../../../src/engine/parser/ts-morph-adapter.js";
import type { RuleDefinition } from "../../../src/engine/registry.js";
import { runRules } from "../../../src/engine/runner.js";
import { extractNestAppModel } from "../../../src/framework/nest/extract.js";
import { dtoFieldWithoutValidator } from "../../../src/rules/nest/dto-field-without-validator.js";
import { missingGlobalValidationPipe } from "../../../src/rules/nest/missing-global-validation-pipe.js";
import { noAnyInDto } from "../../../src/rules/nest/no-any-in-dto.js";
import { noBusinessLogicInController } from "../../../src/rules/nest/no-business-logic-in-controller.js";
import { noGodService } from "../../../src/rules/nest/no-god-service.js";
import { noRepositoryInController } from "../../../src/rules/nest/no-repository-in-controller.js";

const REPO_ROOT = path.resolve(import.meta.dirname, "../../..");
const FIXTURE_ROOT = path.resolve(
	import.meta.dirname,
	"../../fixtures/nest/layers-dto",
);

/** Runs one rule over a multi-file fixture app with the real extractor. */
function scanNestFixture(
	rule: RuleDefinition,
	fixtureName: string,
): Diagnostic[] {
	const target = path.join(FIXTURE_ROOT, fixtureName);
	const paths = collectFiles({
		target,
		extensions: SUPPORTED_EXTENSIONS,
		excludes: [],
		ignoreGlobs: [],
	});
	const adapter = new TsMorphParserAdapter();
	const { files: views } = adapter.createProject(paths);
	const nestModel = extractNestAppModel(views, adapter);

	const diagnostics: Diagnostic[] = [];
	for (const view of views) {
		diagnostics.push(
			...runRules({
				file: view,
				rules: [rule],
				config: defaultConfig(),
				adapter,
				scanRoot: target,
				detectedFrameworks: ["nest"],
				nestModel,
			}).diagnostics,
		);
	}
	return diagnostics;
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

function expectFixturesAndDoc(rule: RuleDefinition, fixtureName: string): void {
	for (const dir of ["valid", "invalid"]) {
		expect(fs.existsSync(path.join(FIXTURE_ROOT, fixtureName, dir)), dir).toBe(
			true,
		);
	}
	expect(fs.existsSync(path.join(REPO_ROOT, rule.docs)), rule.docs).toBe(true);
}

describe("backend-doctor/no-business-logic-in-controller (AC-4, AC-14)", () => {
	it("flags handlers with two or more branch points (AC-4)", () => {
		expect(
			summarize(
				scanNestFixture(
					noBusinessLogicInController,
					"controller-logic/invalid",
				),
			),
		).toEqual([
			{
				file: path.join("controller-logic", "invalid", "orders.controller.ts"),
				line: 5,
				column: 2,
				message:
					"create in OrdersController carries 2 branch points; this reads as business logic living in the controller. Move the branching into a service and keep the handler a thin delegation.",
				severity: "warn",
				category: "Architecture",
			},
			{
				file: path.join("controller-logic", "invalid", "orders.controller.ts"),
				line: 17,
				column: 2,
				message:
					"list in OrdersController carries 2 branch points; this reads as business logic living in the controller. Move the branching into a service and keep the handler a thin delegation.",
				severity: "warn",
				category: "Architecture",
			},
		]);
	});

	it("stays silent on guard clauses, delegation and non-verb methods (AC-4)", () => {
		expect(
			scanNestFixture(noBusinessLogicInController, "controller-logic/valid"),
		).toEqual([]);
	});

	it("ships valid/invalid fixtures and a rule doc (AC-14)", () => {
		expectFixturesAndDoc(noBusinessLogicInController, "controller-logic");
	});
});

describe("backend-doctor/no-repository-in-controller (AC-5, AC-14)", () => {
	it("flags decorator, suffix and Prisma-client repository injections (AC-5)", () => {
		expect(
			summarize(
				scanNestFixture(
					noRepositoryInController,
					"controller-repository/invalid",
				),
			),
		).toEqual([
			{
				file: path.join(
					"controller-repository",
					"invalid",
					"tasks.controller.ts",
				),
				line: 7,
				column: 3,
				message:
					"UsersRepository is injected directly into the controller TasksController; bypassing the service layer couples HTTP handling to storage. Inject a service that owns the repository instead.",
				severity: "warn",
				category: "Architecture",
			},
			{
				file: path.join(
					"controller-repository",
					"invalid",
					"tasks.controller.ts",
				),
				line: 8,
				column: 3,
				message:
					"PrismaService is injected directly into the controller TasksController; bypassing the service layer couples HTTP handling to storage. Inject a service that owns the repository instead.",
				severity: "warn",
				category: "Architecture",
			},
			{
				file: path.join(
					"controller-repository",
					"invalid",
					"tasks.controller.ts",
				),
				line: 9,
				column: 3,
				message:
					"AuditRepository is injected directly into the controller TasksController; bypassing the service layer couples HTTP handling to storage. Inject a service that owns the repository instead.",
				severity: "warn",
				category: "Architecture",
			},
		]);
	});

	it("stays silent when repositories are injected into services (AC-5)", () => {
		expect(
			scanNestFixture(noRepositoryInController, "controller-repository/valid"),
		).toEqual([]);
	});

	it("ships valid/invalid fixtures and a rule doc (AC-14)", () => {
		expectFixturesAndDoc(noRepositoryInController, "controller-repository");
	});
});

/** Runs one rule over a temp tree with the given source file. */
function scanTempSource(
	rule: RuleDefinition,
	fileName: string,
	source: string,
): Diagnostic[] {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "backend-doctor-layers-"));
	fs.writeFileSync(path.join(dir, fileName), source);
	try {
		const paths = collectFiles({
			target: dir,
			extensions: SUPPORTED_EXTENSIONS,
			excludes: [],
			ignoreGlobs: [],
		});
		const adapter = new TsMorphParserAdapter();
		const { files: views } = adapter.createProject(paths);
		const nestModel = extractNestAppModel(views, adapter);
		const diagnostics: Diagnostic[] = [];
		for (const view of views) {
			diagnostics.push(
				...runRules({
					file: view,
					rules: [rule],
					config: defaultConfig(),
					adapter,
					scanRoot: dir,
					detectedFrameworks: ["nest"],
					nestModel,
				}).diagnostics,
			);
		}
		return diagnostics;
	} finally {
		fs.rmSync(dir, { recursive: true, force: true });
	}
}

function serviceWithManyMethods(methodCount: number): string {
	const methods = Array.from(
		{ length: methodCount },
		(_, i) => `\tmethod${i + 1}(): number {\n\t\treturn ${i + 1};\n\t}\n`,
	).join("\n");
	return (
		'import { Injectable } from "@nestjs/common";\n\n' +
		"@Injectable()\nexport class BigService {\n" +
		"\tonModuleInit(): void {}\n\n" +
		methods +
		"}\n"
	);
}

describe("backend-doctor/no-god-service (AC-6, AC-14)", () => {
	it("flags a provider with six constructor dependencies (AC-6)", () => {
		expect(
			summarize(scanNestFixture(noGodService, "god-service/invalid")),
		).toEqual([
			{
				file: path.join("god-service", "invalid", "dashboard.service.ts"),
				line: 3,
				column: 1,
				message:
					"DashboardService carries 6 constructor dependencies and 0 public methods; that breadth is a god-service smell. Split it along domain responsibilities into smaller providers.",
				severity: "warn",
				category: "Maintainability",
			},
		]);
	});

	it("stays silent at five constructor dependencies (AC-6)", () => {
		expect(scanNestFixture(noGodService, "god-service/valid")).toEqual([]);
	});

	it("flags twelve public methods, not eleven; lifecycle hooks excluded (AC-6)", () => {
		const diagnostics = scanTempSource(
			noGodService,
			"big.service.ts",
			serviceWithManyMethods(12),
		);
		expect(diagnostics.map((d) => path.basename(d.filePath))).toEqual([
			"big.service.ts",
		]);
		expect(
			diagnostics.map(({ line, column, message, severity, category }) => ({
				line,
				column,
				message,
				severity,
				category,
			})),
		).toEqual([
			{
				line: 3,
				column: 1,
				message:
					"BigService carries 0 constructor dependencies and 12 public methods; that breadth is a god-service smell. Split it along domain responsibilities into smaller providers.",
				severity: "warn",
				category: "Maintainability",
			},
		]);
		expect(
			scanTempSource(
				noGodService,
				"big.service.ts",
				serviceWithManyMethods(11),
			),
		).toEqual([]);
	});

	it("ships valid/invalid fixtures and a rule doc (AC-14)", () => {
		expectFixturesAndDoc(noGodService, "god-service");
	});
});

describe("backend-doctor/missing-global-validation-pipe (AC-7, AC-14)", () => {
	it("flags a bootstrap with no global ValidationPipe (AC-7)", () => {
		expect(
			summarize(
				scanNestFixture(missingGlobalValidationPipe, "validation-pipe/invalid"),
			),
		).toEqual([
			{
				file: path.join("validation-pipe", "invalid", "main.ts"),
				line: 5,
				column: 20,
				message:
					"NestFactory.create is called here but no global ValidationPipe is registered (no useGlobalPipes(new ValidationPipe(…)) in this file and no APP_PIPE provider in the scanned modules). Request bodies reach handlers unvalidated. Enable ValidationPipe globally in the bootstrap or provide it under the APP_PIPE token.",
				severity: "warn",
				category: "Configuration",
			},
		]);
	});

	it("stays silent when useGlobalPipes registers the pipe (AC-7)", () => {
		expect(
			scanNestFixture(missingGlobalValidationPipe, "validation-pipe/valid"),
		).toEqual([]);
	});

	it("stays silent when APP_PIPE provides the pipe via a module (AC-7)", () => {
		expect(
			scanNestFixture(
				missingGlobalValidationPipe,
				"validation-pipe/valid-app-pipe",
			),
		).toEqual([]);
	});

	it("fails open when providers metadata is unresolved (AC-7)", () => {
		expect(
			scanNestFixture(
				missingGlobalValidationPipe,
				"validation-pipe/valid-fail-open",
			),
		).toEqual([]);
	});

	it("ships valid/invalid fixtures and a rule doc (AC-14)", () => {
		expectFixturesAndDoc(missingGlobalValidationPipe, "validation-pipe");
	});
});

describe("backend-doctor/dto-field-without-validator (AC-8, AC-14)", () => {
	it("flags bare, ApiProperty-only and ApiPropertyOptional-only DTO properties (AC-8)", () => {
		expect(
			summarize(
				scanNestFixture(dtoFieldWithoutValidator, "dto-fields/invalid"),
			),
		).toEqual([
			{
				file: path.join("dto-fields", "invalid", "create-user.dto.ts"),
				line: 4,
				column: 2,
				message:
					"email in CreateUserDto has no validation decorator; with a global ValidationPipe it is never validated. Add a class-validator decorator (@IsString, @IsInt, @IsOptional, …).",
				severity: "warn",
				category: "Correctness",
			},
			{
				file: path.join("dto-fields", "invalid", "create-user.dto.ts"),
				line: 6,
				column: 2,
				message:
					"role in CreateUserDto has no validation decorator; with a global ValidationPipe it is never validated. Add a class-validator decorator (@IsString, @IsInt, @IsOptional, …).",
				severity: "warn",
				category: "Correctness",
			},
			{
				file: path.join("dto-fields", "invalid", "create-user.dto.ts"),
				line: 9,
				column: 2,
				message:
					"bio in CreateUserDto has no validation decorator; with a global ValidationPipe it is never validated. Add a class-validator decorator (@IsString, @IsInt, @IsOptional, …).",
				severity: "warn",
				category: "Correctness",
			},
		]);
	});

	it("stays silent when any validator outside the blacklist decorates the field (AC-8)", () => {
		expect(
			scanNestFixture(dtoFieldWithoutValidator, "dto-fields/valid"),
		).toEqual([]);
	});

	it("ships valid/invalid fixtures and a rule doc (AC-14)", () => {
		expectFixturesAndDoc(dtoFieldWithoutValidator, "dto-fields");
	});
});

describe("backend-doctor/no-any-in-dto (AC-9, AC-14)", () => {
	it("flags any, any[], Array<any> and implicit-any DTO properties (AC-9)", () => {
		expect(
			summarize(scanNestFixture(noAnyInDto, "any-fields/invalid")),
		).toEqual([
			{
				file: path.join("any-fields", "invalid", "any-fields.dto.ts"),
				line: 2,
				column: 2,
				message:
					"metadata in CreateItemDto is typed any; the payload shape is unchecked end to end. Give the field a concrete type or a nested DTO class.",
				severity: "warn",
				category: "Maintainability",
			},
			{
				file: path.join("any-fields", "invalid", "any-fields.dto.ts"),
				line: 4,
				column: 2,
				message:
					"tags in CreateItemDto is typed any; the payload shape is unchecked end to end. Give the field a concrete type or a nested DTO class.",
				severity: "warn",
				category: "Maintainability",
			},
			{
				file: path.join("any-fields", "invalid", "any-fields.dto.ts"),
				line: 6,
				column: 2,
				message:
					"payload in CreateItemDto is typed any; the payload shape is unchecked end to end. Give the field a concrete type or a nested DTO class.",
				severity: "warn",
				category: "Maintainability",
			},
			{
				file: path.join("any-fields", "invalid", "any-fields.dto.ts"),
				line: 8,
				column: 2,
				message:
					"note in CreateItemDto has no type annotation and no initializer, so it is implicitly any; the payload shape is unchecked end to end. Give the field a concrete type or a nested DTO class.",
				severity: "warn",
				category: "Maintainability",
			},
		]);
	});

	it("stays silent on concrete types and initialized untyped properties (AC-9)", () => {
		expect(scanNestFixture(noAnyInDto, "any-fields/valid")).toEqual([]);
	});

	it("ships valid/invalid fixtures and a rule doc (AC-14)", () => {
		expectFixturesAndDoc(noAnyInDto, "any-fields");
	});
});

describe("pack silence paths (AC-10, AC-11)", () => {
	it("is a no-op for every rule when the nest model is absent (AC-11)", () => {
		const target = path.join(FIXTURE_ROOT, "controller-logic", "valid");
		const paths = collectFiles({
			target,
			extensions: SUPPORTED_EXTENSIONS,
			excludes: [],
			ignoreGlobs: [],
		});
		const adapter = new TsMorphParserAdapter();
		const { files: views } = adapter.createProject(paths);
		const rules = [
			noBusinessLogicInController,
			noRepositoryInController,
			noGodService,
			missingGlobalValidationPipe,
			dtoFieldWithoutValidator,
			noAnyInDto,
		];
		const diagnostics: Diagnostic[] = [];
		for (const view of views) {
			diagnostics.push(
				...runRules({
					file: view,
					rules,
					config: defaultConfig(),
					adapter,
					scanRoot: target,
					detectedFrameworks: ["nest"],
				}).diagnostics,
			);
		}
		expect(diagnostics).toEqual([]);
	});

	it("reports nothing for files without pack triggers (AC-10)", () => {
		expect(scanNestFixture(noGodService, "controller-logic/valid")).toEqual([]);
		expect(scanNestFixture(noAnyInDto, "controller-repository/valid")).toEqual(
			[],
		);
	});
});
