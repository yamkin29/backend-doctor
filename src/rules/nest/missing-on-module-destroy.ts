import { SyntaxKind } from "../../engine/parser/types.js";
import { defineRule } from "../../engine/registry.js";

const INIT_HOOKS = new Set(["onModuleInit", "onApplicationBootstrap"]);

const SHUTDOWN_HOOKS = new Set([
	"onModuleDestroy",
	"beforeApplicationShutdown",
	"onApplicationShutdown",
]);

/**
 * Flags model providers that acquire resources in an init hook but declare
 * no shutdown hook — whatever they open is never released on shutdown (spec
 * 011 AC-3). Method-name matching covers `implements OnModuleInit` and bare
 * declarations alike; any of the three shutdown hooks satisfies cleanup.
 * Controllers and non-Nest classes are out of scope (providers hold the
 * resources). Reported at the model's class position (the leading `@`).
 */
export const missingOnModuleDestroy = defineRule({
	id: "backend-doctor/missing-on-module-destroy",
	title: "Missing onModuleDestroy",
	category: "Correctness",
	severity: "warn",
	docs: "docs/rules/backend-doctor/missing-on-module-destroy.md",
	frameworks: ["nest"],
	create(ctx) {
		const model = ctx.nest;
		if (!model) return;
		const providers = model.providers.filter(
			(provider) => provider.filePath === ctx.file.filePath,
		);
		if (providers.length === 0) return;

		ctx.file.forEachDescendant((node) => {
			const cls = node.asKind(SyntaxKind.ClassDeclaration);
			if (!cls) return undefined;
			const className = cls.getName();
			const entry = className
				? providers.find((provider) => provider.className === className)
				: undefined;
			if (!entry) return undefined;

			let initHook: string | undefined;
			let hasShutdownHook = false;
			for (const method of cls.getMethods()) {
				if (method.isStatic()) continue;
				const name = method.getName();
				if (!name) continue;
				if (!initHook && INIT_HOOKS.has(name)) initHook = name;
				if (SHUTDOWN_HOOKS.has(name)) hasShutdownHook = true;
			}
			if (!initHook || hasShutdownHook) return undefined;

			ctx.report({
				line: entry.line,
				column: entry.column,
				message: `${className} initializes in ${initHook} but declares no shutdown hook; resources acquired there are never released. Add onModuleDestroy (or beforeApplicationShutdown / onApplicationShutdown) to release them.`,
			});
			return undefined;
		});
	},
});
