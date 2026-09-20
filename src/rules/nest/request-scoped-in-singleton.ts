import { defineRule } from "../../engine/registry.js";
import { consumersInFile } from "./di-graph.js";

/**
 * Flags request-scoped providers injected into singleton consumers: Nest
 * propagates request scope up the dependency chain, so the consumer and its
 * subtree silently start rebuilding on every request (spec 009 AC-10).
 * Request-scoped and transient consumers are deliberate usage, not a finding.
 */
export const requestScopedInSingleton = defineRule({
	id: "backend-doctor/request-scoped-in-singleton",
	title: "Request-scoped provider in singleton",
	category: "Performance",
	severity: "warn",
	docs: "docs/rules/backend-doctor/request-scoped-in-singleton.md",
	frameworks: ["nest"],
	create(ctx) {
		const model = ctx.nest;
		if (!model) return;
		const requestScoped = new Set(
			model.providers
				.filter((provider) => provider.scope === "request")
				.map((provider) => provider.className),
		);
		if (requestScoped.size === 0) return;
		for (const consumer of consumersInFile(model, ctx.file.filePath)) {
			if (consumer.scope === "request" || consumer.scope === "transient") {
				continue;
			}
			for (const injection of consumer.injections) {
				if (!requestScoped.has(injection.name)) continue;
				ctx.report({
					line: injection.line,
					column: injection.column,
					message: `${injection.name} is request-scoped; injecting it into the singleton ${consumer.className} makes ${consumer.className} and its subtree rebuild on every request. Keep request state out of DI scope (pass it per call) or accept the per-request cost explicitly.`,
				});
			}
		}
	},
});
