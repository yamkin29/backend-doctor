import { readFileSync } from "node:fs";

const FALLBACK_VERSION = "0.0.0";

/**
 * Resolves the CLI version from the nearest package.json. Works both from the
 * repo layout (src/cli → root) and from the published layout
 * (dist/bin → package root) because the file sits two levels below package.json
 * in both cases.
 */
export function resolveVersion(): string {
	try {
		const raw = readFileSync(
			new URL("../../package.json", import.meta.url),
			"utf8",
		);
		const pkg = JSON.parse(raw) as { version?: string };
		return pkg.version ?? FALLBACK_VERSION;
	} catch {
		return FALLBACK_VERSION;
	}
}
