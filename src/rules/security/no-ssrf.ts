import {
	type CallExpression,
	type Expression,
	Node,
	SyntaxKind,
} from "../../engine/parser/types.js";
import { defineRule } from "../../engine/registry.js";
import { findModuleApiCalls } from "../shared/module-api-calls.js";
import { containsRequestInput } from "./request-input.js";

const AXIOS_SPECIFIERS = ["axios"] as const;
const AXIOS_METHODS = [
	"get",
	"post",
	"put",
	"patch",
	"delete",
	"request",
] as const;

function firstArgumentHasRequestInput(call: CallExpression): boolean {
	const first = call.getArguments()[0];
	if (first === undefined || first.getKind() === SyntaxKind.SpreadElement) {
		return false;
	}
	return containsRequestInput(first as Expression);
}

/** Bare `fetch` only — `globalThis.fetch` and object methods are holes. */
function isBareFetch(call: CallExpression): boolean {
	return Node.isIdentifier(call.getExpression());
}

/**
 * Bare `axios(config)` calls; property-form method names are accepted only
 * on a receiver that is literally `axios` (http clients collide).
 */
function isAxiosCallee(call: CallExpression, name: string): boolean {
	if (Node.isIdentifier(call.getExpression())) return name === "axios";
	const access = call
		.getExpression()
		.asKind(SyntaxKind.PropertyAccessExpression);
	if (!access) return false;
	const receiver = access.getExpression();
	return Node.isIdentifier(receiver) && receiver.getText() === "axios";
}

/**
 * Flags fetching request-derived URLs (spec 007): the canonical SSRF shape.
 * fetch is ungated (a global, shadow-checked by the collector); the axios
 * forms require an axios specifier. Literal URLs are never findings;
 * config-object forms (`axios({ url: … })`) are a documented hole.
 */
export const noSsrf = defineRule({
	id: "backend-doctor/no-ssrf",
	title: "No SSRF",
	category: "Security",
	severity: "warn",
	docs: "docs/rules/backend-doctor/no-ssrf.md",
	create(ctx) {
		const matches = [
			...findModuleApiCalls(ctx.file, {
				names: ["fetch"],
				accept: (call) =>
					isBareFetch(call) && firstArgumentHasRequestInput(call),
				insideFunctionBodies: false,
			}),
			...findModuleApiCalls(ctx.file, {
				specifiers: AXIOS_SPECIFIERS,
				names: ["axios", ...AXIOS_METHODS],
				accept: (call, name) =>
					isAxiosCallee(call, name) && firstArgumentHasRequestInput(call),
				insideFunctionBodies: false,
			}),
		];
		for (const { call } of matches) {
			ctx.report({
				node: call,
				message:
					"Fetching a URL taken from request input lets attackers reach internal services (SSRF). Validate the host against an allowlist before requesting it.",
			});
		}
	},
});
