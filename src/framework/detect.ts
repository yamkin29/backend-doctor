import fs from "node:fs";
import path from "node:path";
import type { SkippedCheck } from "../core/types.js";
import type { SourceFileView } from "../engine/parser/types.js";
import { FRAMEWORK_MARKERS, type FrameworkMarkers } from "./markers.js";

export interface DetectFrameworksInput {
	/** Absolute path of the package root (nearest package.json dir, fallback target). */
	packageRoot: string;
	/** Absolute scan target — the base for target-relative skippedChecks reasons. */
	scanRoot: string;
	/** Parsed source files, the source of code markers. */
	files: readonly SourceFileView[];
}

export interface DetectFrameworksResult {
	/** Unique framework ids, sorted alphabetically. */
	frameworks: string[];
	skippedChecks: SkippedCheck[];
}

/**
 * Framework detection (spec 004): a framework is detected when any of its
 * markers matches — a direct dependency of the project's package.json, a
 * module specifier referenced by an analyzed file, or a marker file under the
 * package root. Pure and deterministic. A package.json that cannot be read or
 * parsed is reported instead of failing the scan (constitution §8); its
 * absence is a normal state (code and file markers still apply).
 */
export function detectFrameworks(
	input: DetectFrameworksInput,
): DetectFrameworksResult {
	const skippedChecks: SkippedCheck[] = [];
	const declared = readDependencies(input, skippedChecks);
	const detected = new Set<string>();

	for (const markers of FRAMEWORK_MARKERS) {
		const byDependency = markers.dependencies.some((name) =>
			declared.has(name),
		);
		const byFile = markers.files.some((relative) =>
			fs.existsSync(path.join(input.packageRoot, relative)),
		);
		const byImport = input.files.some((file) =>
			file
				.getModuleSpecifiers()
				.some((specifier) => matchesSpecifier(markers, specifier)),
		);
		if (byDependency || byFile || byImport) detected.add(markers.id);
	}

	return { frameworks: [...detected].sort(), skippedChecks };
}

function matchesSpecifier(
	markers: FrameworkMarkers,
	specifier: string,
): boolean {
	return (
		markers.exactImports.includes(specifier) ||
		markers.prefixImports.some((prefix) => specifier.startsWith(prefix))
	);
}

function readDependencies(
	input: DetectFrameworksInput,
	skippedChecks: SkippedCheck[],
): Set<string> {
	const filePath = path.join(input.packageRoot, "package.json");
	if (!fs.existsSync(filePath)) return new Set();

	let content: string;
	try {
		content = fs.readFileSync(filePath, "utf8");
	} catch (error) {
		skippedChecks.push(
			failureEntry(
				input,
				filePath,
				`read failed — ${(error as Error).message}`,
			),
		);
		return new Set();
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(content);
	} catch (error) {
		skippedChecks.push(
			failureEntry(
				input,
				filePath,
				`invalid JSON — ${(error as Error).message}`,
			),
		);
		return new Set();
	}

	if (!isPlainObject(parsed)) {
		skippedChecks.push(failureEntry(input, filePath, "root must be an object"));
		return new Set();
	}
	const dependencies = parsed.dependencies;
	if (dependencies === undefined) return new Set();
	if (!isPlainObject(dependencies)) {
		skippedChecks.push(
			failureEntry(input, filePath, `"dependencies" must be an object`),
		);
		return new Set();
	}
	return new Set(Object.keys(dependencies));
}

function failureEntry(
	input: DetectFrameworksInput,
	filePath: string,
	reason: string,
): SkippedCheck {
	return {
		check: "framework-detection",
		reason: `${relativeTo(input.scanRoot, filePath)}: ${reason}`,
	};
}

function relativeTo(target: string, filePath: string): string {
	return path.relative(target, filePath).split(path.sep).join("/");
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
