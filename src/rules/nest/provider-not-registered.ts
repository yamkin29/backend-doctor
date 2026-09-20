import { defineRule } from "../../engine/registry.js";
import { consumersInFile, isInjectionResolvable } from "./di-graph.js";

/**
 * Flags constructor injections of provider classes that none of the
 * consumer's owning modules can resolve (spec 009 AC-6). The resolvability
 * walk fails open on every unreadable shape, so only provably broken wiring
 * is reported (constitution §2).
 */
export const providerNotRegistered = defineRule({
	id: "backend-doctor/provider-not-registered",
	title: "Provider not registered",
	category: "Correctness",
	severity: "warn",
	docs: "docs/rules/backend-doctor/provider-not-registered.md",
	frameworks: ["nest"],
	create(ctx) {
		const model = ctx.nest;
		if (!model) return;
		for (const consumer of consumersInFile(model, ctx.file.filePath)) {
			for (const injection of consumer.injections) {
				if (isInjectionResolvable(model, consumer, injection.name)) continue;
				ctx.report({
					line: injection.line,
					column: injection.column,
					message: `${injection.name} is injected here but none of the modules registering ${consumer.className} provide or export it (directly or via imports); Nest fails to resolve this dependency at bootstrap. Add ${injection.name} to a providers array or import a module that provides it.`,
				});
			}
		}
	},
});
