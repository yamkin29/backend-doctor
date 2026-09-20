import { defineRule } from "../../engine/registry.js";

/** Type names ending here read as repositories (`UsersRepository`). */
const REPOSITORY_SUFFIX = /Repository$/;

/** The canonical Prisma client names, injected directly = storage coupling. */
const DATABASE_CLIENTS = new Set(["PrismaService", "PrismaClient"]);

/**
 * Flags controller constructor injections of repositories: a parameter
 * carrying `@InjectRepository`, a type name ending in `Repository`, or the
 * exact names `PrismaService` / `PrismaClient` (spec 010 AC-5). The same
 * injections inside a provider are correct usage — services own storage.
 */
export const noRepositoryInController = defineRule({
	id: "backend-doctor/no-repository-in-controller",
	title: "Repository injected into controller",
	category: "Architecture",
	severity: "warn",
	docs: "docs/rules/backend-doctor/no-repository-in-controller.md",
	frameworks: ["nest"],
	create(ctx) {
		const model = ctx.nest;
		if (!model) return;
		for (const controller of model.controllers) {
			if (controller.filePath !== ctx.file.filePath) continue;
			for (const injection of controller.injections) {
				const isRepository =
					injection.decoratorNames.includes("InjectRepository") ||
					REPOSITORY_SUFFIX.test(injection.name) ||
					DATABASE_CLIENTS.has(injection.name);
				if (!isRepository) continue;
				ctx.report({
					line: injection.line,
					column: injection.column,
					message: `${injection.name} is injected directly into the controller ${controller.className}; bypassing the service layer couples HTTP handling to storage. Inject a service that owns the repository instead.`,
				});
			}
		}
	},
});
