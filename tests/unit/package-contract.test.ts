import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Spec 023: the publish-relevant contract of `package.json`, pinned exactly.
 * These fields are consumed by the npm registry, the composite action's
 * `npm install -g backend-doctor@<version>` path and the maintainer workflows;
 * a silent drift in any of them changes what users download or run, so the
 * expected values are spelled out in full rather than spot-checked.
 */

const repoRoot = path.resolve(
	fileURLToPath(import.meta.url),
	"../../../package.json",
);

interface PackageJson {
	scripts?: Record<string, string>;
	author?: string;
	repository?: { type: string; url: string };
	homepage?: string;
	bugs?: { url: string };
	keywords?: string[];
	files?: string[];
}

const pkg = JSON.parse(fs.readFileSync(repoRoot, "utf8")) as PackageJson;

describe("package.json publish contract (spec 023)", () => {
	it("pins the publish gate and the rule-docs alias scripts", () => {
		expect(pkg.scripts?.prepublishOnly).toBe(
			"pnpm lint && pnpm typecheck && pnpm test && pnpm build",
		);
		expect(pkg.scripts?.["docs:rules"]).toBe(
			"node dist/scripts/rule-docs.js --check",
		);
	});

	it("pins the registry-facing identity metadata", () => {
		// Post-rename GitHub coordinates per spec 023 OQ-4 (consistent with the
		// F016 action-ref decision); the user renames the repo at/before publish.
		expect(pkg.author).toBe("Aleksey Yamkin");
		expect(pkg.repository).toEqual({
			type: "git",
			url: "git+https://github.com/yamkin29/backend-doctor.git",
		});
		expect(pkg.homepage).toBe(
			"https://github.com/yamkin29/backend-doctor#readme",
		);
		expect(pkg.bugs).toEqual({
			url: "https://github.com/yamkin29/backend-doctor/issues",
		});
		expect(pkg.keywords).toEqual([
			"nestjs",
			"nodejs",
			"backend",
			"static-analysis",
			"lint",
			"prisma",
			"code-quality",
		]);
	});
});
