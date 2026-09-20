import { describe, expect, it } from "vitest";
import {
	isConfigShapedPath,
	isTestShapedPath,
} from "../../../src/rules/config/config-paths.js";
import { isCoveredByGitignore } from "../../../src/rules/config/gitignore.js";

describe("isConfigShapedPath (spec 014, design §2)", () => {
	it("exempts config-shaped directory segments", () => {
		expect(isConfigShapedPath("src/config/settings.ts")).toBe(true);
		expect(isConfigShapedPath("config/db.ts")).toBe(true);
		expect(isConfigShapedPath("src/env/loader.ts")).toBe(true);
		expect(isConfigShapedPath("src/environments/prod.ts")).toBe(true);
		expect(isConfigShapedPath("src/configs/reads.ts")).toBe(true);
		expect(isConfigShapedPath("src/configuration/app.ts")).toBe(true);
		expect(isConfigShapedPath("settings/nested.ts")).toBe(true);
	});

	it("exempts config-shaped basenames", () => {
		expect(isConfigShapedPath("config.ts")).toBe(true);
		expect(isConfigShapedPath("app.config.ts")).toBe(true);
		expect(isConfigShapedPath("env.ts")).toBe(true);
		expect(isConfigShapedPath("env.validation.ts")).toBe(true);
		expect(isConfigShapedPath("src/setupEnvironment.ts")).toBe(true);
		expect(isConfigShapedPath("with-settings.ts")).toBe(true);
	});

	it("is case-insensitive", () => {
		expect(isConfigShapedPath("SRC/Config/Settings.ts")).toBe(true);
		expect(isConfigShapedPath("Main.CONFIG.ts")).toBe(true);
	});

	it("keeps business files in scope", () => {
		expect(isConfigShapedPath("users.service.ts")).toBe(false);
		expect(isConfigShapedPath("src/users/users.service.ts")).toBe(false);
		expect(isConfigShapedPath("main.ts")).toBe(false);
		expect(isConfigShapedPath("src/e2e-utils/helper.ts")).toBe(false);
		expect(isConfigShapedPath("src/orders/controller.ts")).toBe(false);
	});
});

describe("isTestShapedPath (spec 014 resolution 2)", () => {
	it("exempts test-shaped basenames", () => {
		expect(isTestShapedPath("users.service.test.ts")).toBe(true);
		expect(isTestShapedPath("users.service.spec.ts")).toBe(true);
		expect(isTestShapedPath("src/users.service.spec.ts")).toBe(true);
	});

	it("exempts test-shaped directory segments", () => {
		expect(isTestShapedPath("tests/setup.ts")).toBe(true);
		expect(isTestShapedPath("test/helper.ts")).toBe(true);
		expect(isTestShapedPath("__tests__/users.ts")).toBe(true);
		expect(isTestShapedPath("e2e/login.ts")).toBe(true);
	});

	it("is case-insensitive", () => {
		expect(isTestShapedPath("Tests/setup.ts")).toBe(true);
		expect(isTestShapedPath("src/users.TEST.ts")).toBe(true);
	});

	it("keeps non-test files in scope", () => {
		expect(isTestShapedPath("src/users.service.ts")).toBe(false);
		expect(isTestShapedPath("testing.ts")).toBe(false);
		expect(isTestShapedPath("main.ts")).toBe(false);
	});
});

describe("isCoveredByGitignore (spec 014, design §5)", () => {
	it("matches literal lines", () => {
		expect(isCoveredByGitignore(".env", ".env\n")).toBe(true);
		expect(isCoveredByGitignore(".env.local", ".env.local\n")).toBe(true);
		expect(isCoveredByGitignore(".env", "dist\nnode_modules\n")).toBe(false);
	});

	it("strips a leading slash from anchored patterns", () => {
		expect(isCoveredByGitignore(".env", "/.env\n")).toBe(true);
	});

	it("never matches directory-only patterns against a file", () => {
		expect(isCoveredByGitignore(".env", ".env/\n")).toBe(false);
	});

	it("never matches patterns anchored to a nested directory", () => {
		expect(isCoveredByGitignore(".env", "config/.env\n")).toBe(false);
	});

	it("matches glob lines via picomatch with dot semantics", () => {
		expect(isCoveredByGitignore(".env.production", ".env.*\n")).toBe(true);
		expect(isCoveredByGitignore(".env.local", "*.local\n")).toBe(true);
		expect(isCoveredByGitignore(".env", ".env*\n")).toBe(true);
	});

	it("matches globstar patterns against root-level candidates", () => {
		expect(isCoveredByGitignore(".env", "**/.env\n")).toBe(true);
	});

	it("skips comments and blank lines", () => {
		expect(isCoveredByGitignore(".env", "# .env\n\n.env\n")).toBe(true);
		expect(isCoveredByGitignore(".env", "#.env\n")).toBe(false);
	});

	it("respects negation with last-match-wins", () => {
		expect(isCoveredByGitignore(".env.test", ".env*\n!.env.test\n")).toBe(
			false,
		);
		expect(isCoveredByGitignore(".env.local", ".env*\n!.env.test\n")).toBe(
			true,
		);
		expect(isCoveredByGitignore(".env", "!.env\n.env\n")).toBe(true);
		expect(isCoveredByGitignore(".env", ".env\n!.env\n")).toBe(false);
	});

	it("trims surrounding whitespace and a UTF-8 BOM", () => {
		expect(isCoveredByGitignore(".env", "  .env  \n")).toBe(true);
		expect(isCoveredByGitignore(".env", "\uFEFF.env\n")).toBe(true);
	});

	it("stays silent on empty coverage", () => {
		expect(isCoveredByGitignore(".env", "")).toBe(false);
	});
});
