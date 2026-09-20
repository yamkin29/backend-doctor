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
