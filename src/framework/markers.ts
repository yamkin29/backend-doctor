/**
 * The detection matrix from spec 004 as plain data. A framework is detected
 * when any of its markers matches: an exact `dependencies` key in the
 * project's package.json, a module specifier imported by an analyzed file
 * (exact or prefix), or a marker file relative to the package root.
 *
 * Marker names are runtime packages on purpose: dev-tooling packages
 * (`@nestjs/cli`, `@nestjs/testing`) and ecosystem-adjacent packages
 * (`@types/*`, `fastify-plugin`, `@fastify/*`) never activate a pack
 * (constitution §2 — precision over recall).
 */
export interface FrameworkMarkers {
	/** Framework id as reported in `projects[].frameworks`. */
	readonly id: string;
	/** Exact package.json dependency keys that activate the framework. */
	readonly dependencies: readonly string[];
	/** Exact module specifiers that activate the framework. */
	readonly exactImports: readonly string[];
	/** Module specifier prefixes that activate the framework. */
	readonly prefixImports: readonly string[];
	/** Files (packageRoot-relative, posix) whose existence activates the framework. */
	readonly files: readonly string[];
}

export const FRAMEWORK_MARKERS: readonly FrameworkMarkers[] = [
	{
		id: "nest",
		dependencies: ["@nestjs/common", "@nestjs/core"],
		exactImports: ["@nestjs/common", "@nestjs/core"],
		prefixImports: ["@nestjs/platform-"],
		files: [],
	},
	{
		id: "express",
		dependencies: ["express"],
		exactImports: ["express"],
		prefixImports: [],
		files: [],
	},
	{
		id: "fastify",
		dependencies: ["fastify"],
		exactImports: ["fastify"],
		prefixImports: [],
		files: [],
	},
	{
		id: "prisma",
		dependencies: ["@prisma/client"],
		exactImports: ["@prisma/client"],
		prefixImports: [],
		files: ["prisma/schema.prisma"],
	},
];
