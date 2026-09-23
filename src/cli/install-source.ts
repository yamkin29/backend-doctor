import { fileURLToPath } from "node:url";

/**
 * Resolves the shipped agent skill folder (spec 024). Works both from the
 * repo layout (src/cli → root) and from the published layout
 * (dist/bin → package root) because the file sits two levels below the
 * package root in both cases — the resolveVersion() precedent.
 */
export function resolveSkillSourceDir(): string {
	return fileURLToPath(
		new URL("../../skills/backend-doctor/", import.meta.url),
	);
}
