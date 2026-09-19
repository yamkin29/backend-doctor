import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TsMorphParserAdapter } from "../../../src/engine/parser/ts-morph-adapter.js";
import type { SourceFileView } from "../../../src/engine/parser/types.js";
import { detectFrameworks } from "../../../src/framework/detect.js";

let root: string;

beforeEach(() => {
	root = fs.mkdtempSync(path.join(os.tmpdir(), "backend-doctor-detect-"));
});

afterEach(() => {
	fs.rmSync(root, { recursive: true, force: true });
});

function writePackageJson(dependencies: Record<string, string> | string): void {
	const content =
		typeof dependencies === "string"
			? dependencies
			: JSON.stringify({ name: "app", dependencies });
	fs.writeFileSync(path.join(root, "package.json"), content);
}

function writeFile(relPath: string, content: string): void {
	const file = path.join(root, relPath);
	fs.mkdirSync(path.dirname(file), { recursive: true });
	fs.writeFileSync(file, content);
}

function parse(relPaths: string[]): SourceFileView[] {
	const adapter = new TsMorphParserAdapter();
	return adapter.createProject(relPaths.map((rel) => path.join(root, rel)))
		.files;
}

function detect(files: SourceFileView[] = [], packageRoot = root) {
	return detectFrameworks({ packageRoot, scanRoot: root, files });
}

describe("detectFrameworks — package.json markers (AC-1..4)", () => {
	it("detects nest from @nestjs/common or @nestjs/core dependencies (AC-1)", () => {
		writePackageJson({ "@nestjs/common": "^10.0.0" });
		expect(detect().frameworks).toEqual(["nest"]);

		writePackageJson({ "@nestjs/core": "^10.0.0" });
		expect(detect().frameworks).toEqual(["nest"]);
	});

	it("detects express from an express dependency (AC-2)", () => {
		writePackageJson({ express: "^4.19.2" });
		expect(detect().frameworks).toEqual(["express"]);
	});

	it("detects fastify from a fastify dependency (AC-3)", () => {
		writePackageJson({ fastify: "^4.24.0" });
		expect(detect().frameworks).toEqual(["fastify"]);
	});

	it("detects prisma from an @prisma/client dependency (AC-4)", () => {
		writePackageJson({ "@prisma/client": "^5.0.0" });
		expect(detect().frameworks).toEqual(["prisma"]);
	});

	it("detects prisma from the schema file alone (AC-4)", () => {
		writeFile("prisma/schema.prisma", "model User { id Int @id }\n");
		expect(detect().frameworks).toEqual(["prisma"]);
	});
});

describe("detectFrameworks — code markers (AC-5)", () => {
	it("activates frameworks from imports without any package.json (AC-5)", () => {
		writeFile("src/main.ts", 'import { Controller } from "@nestjs/common";\n');
		writeFile("src/legacy.ts", 'const express = require("express");\n');
		writeFile("src/lazy.ts", 'export const load = () => import("fastify");\n');

		const { frameworks } = detect(
			parse(["src/lazy.ts", "src/legacy.ts", "src/main.ts"]),
		);
		expect(frameworks).toEqual(["express", "fastify", "nest"]);
	});

	it("matches @nestjs/platform- prefixed specifiers (AC-5)", () => {
		writeFile(
			"src/main.ts",
			'import { ExpressAdapter } from "@nestjs/platform-express";\n',
		);
		expect(detect(parse(["src/main.ts"])).frameworks).toEqual(["nest"]);
	});
});

describe("detectFrameworks — output shape (AC-6, AC-7)", () => {
	it("reports an empty list when no marker matches (AC-6)", () => {
		writePackageJson({ lodash: "^4.17.0" });
		expect(detect().frameworks).toEqual([]);
	});

	it("deduplicates and sorts alphabetically (AC-7)", () => {
		writePackageJson({ express: "^4.19.2", fastify: "^4.24.0" });
		writeFile("src/main.ts", 'import { Controller } from "@nestjs/common";\n');
		// The express marker matches twice (dependency and import).
		writeFile("src/legacy.ts", 'import express from "express";\n');

		const { frameworks } = detect(parse(["src/legacy.ts", "src/main.ts"]));
		expect(frameworks).toEqual(["express", "fastify", "nest"]);
	});
});

describe("detectFrameworks — fail soft (AC-8)", () => {
	it("treats a missing package.json as normal, with no skippedChecks", () => {
		const { frameworks, skippedChecks } = detect();
		expect(frameworks).toEqual([]);
		expect(skippedChecks).toEqual([]);
	});

	it("records malformed package.json and still matches code markers (AC-8)", () => {
		writePackageJson("{ not json");
		writeFile("src/main.ts", 'import express from "express";\n');

		const { frameworks, skippedChecks } = detect(parse(["src/main.ts"]));
		expect(frameworks).toEqual(["express"]);
		expect(skippedChecks).toHaveLength(1);
		expect(skippedChecks[0]).toMatchObject({
			check: "framework-detection",
			reason: expect.stringContaining("package.json"),
		});
	});

	it("records a dependencies field that is not an object (AC-8)", () => {
		writePackageJson('{"dependencies": "express"}');

		const { frameworks, skippedChecks } = detect();
		expect(frameworks).toEqual([]);
		expect(skippedChecks).toHaveLength(1);
		expect(skippedChecks[0]?.check).toBe("framework-detection");
	});

	it("records an unreadable package.json and keeps going (AC-8)", () => {
		if (typeof process.getuid === "function" && process.getuid() === 0) {
			return; // Root ignores file permissions; scenario cannot be staged.
		}
		writePackageJson({ express: "^4.19.2" });
		fs.chmodSync(path.join(root, "package.json"), 0o000);

		const { frameworks, skippedChecks } = detect();
		expect(frameworks).toEqual([]);
		expect(skippedChecks).toHaveLength(1);
		expect(skippedChecks[0]?.check).toBe("framework-detection");
		fs.chmodSync(path.join(root, "package.json"), 0o644);
	});
});

describe("detectFrameworks — precision (AC-12)", () => {
	it("ignores non-marker packages and dev-only Nest imports (AC-12)", () => {
		writePackageJson({
			"@fastify/cors": "^8.0.0",
			"@nestjs/cli": "^10.0.0",
			"@nestjs/testing": "^10.0.0",
			"@types/express": "^4.17.0",
			"fastify-plugin": "^4.0.0",
		});
		writeFile(
			"src/test.spec.ts",
			[
				'import { Test } from "@nestjs/testing";',
				'import plugin from "fastify-plugin";',
				'import cors from "@fastify/cors";',
			].join("\n"),
		);

		expect(detect(parse(["src/test.spec.ts"])).frameworks).toEqual([]);
	});
});
