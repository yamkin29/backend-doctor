import type { CallExpression } from "../../engine/parser/types.js";
import { SyntaxKind } from "../../engine/parser/types.js";
import { defineRule } from "../../engine/registry.js";

/** `NestFactory.<member>(…)` calls that bootstrap an application. */
const CREATE_METHODS = new Set([
	"create",
	"createApplicationContext",
	"createMicroservice",
]);

const VALIDATION_PIPE = "ValidationPipe";

function isNestFactoryCreate(call: CallExpression): boolean {
	const member = call
		.getExpression()
		.asKind(SyntaxKind.PropertyAccessExpression);
	if (!member || !CREATE_METHODS.has(member.getName())) return false;
	const target = member.getExpression().asKind(SyntaxKind.Identifier);
	return target?.getText() === "NestFactory";
}

function registersPipeInFile(call: CallExpression): boolean {
	const member = call
		.getExpression()
		.asKind(SyntaxKind.PropertyAccessExpression);
	if (member?.getName() !== "useGlobalPipes") return false;
	return call.getArguments().some((argument) => {
		const construction = argument.asKind(SyntaxKind.NewExpression);
		if (!construction) return false;
		const callee = construction.getExpression().asKind(SyntaxKind.Identifier);
		return callee?.getText() === VALIDATION_PIPE;
	});
}

/**
 * Flags files that bootstrap a Nest application (`NestFactory.create*`)
 * without a global ValidationPipe — neither `useGlobalPipes(new
 * ValidationPipe(…))` in the same file nor a `ValidationPipe` module
 * providers entry (the `{ provide: APP_PIPE, useClass: ValidationPipe }`
 * shape, spec 010 AC-7). Fails open when any module's providers metadata is
 * unresolved (reason strings are the stable constants of extract.ts).
 */
export const missingGlobalValidationPipe = defineRule({
	id: "backend-doctor/missing-global-validation-pipe",
	title: "Missing global ValidationPipe",
	category: "Configuration",
	severity: "warn",
	docs: "docs/rules/backend-doctor/missing-global-validation-pipe.md",
	frameworks: ["nest"],
	create(ctx) {
		const model = ctx.nest;
		if (!model) return;
		let bootstrapCall: CallExpression | undefined;
		let pipeRegistered = false;
		ctx.file.forEachDescendant((node) => {
			const call = node.asKind(SyntaxKind.CallExpression);
			if (!call) return undefined;
			if (isNestFactoryCreate(call)) bootstrapCall ??= call;
			if (registersPipeInFile(call)) pipeRegistered = true;
			return undefined;
		});
		if (!bootstrapCall || pipeRegistered) return;
		if (model.modules.some((m) => m.providers.includes(VALIDATION_PIPE))) {
			return;
		}
		const providersUnresolved = model.unresolved.some(
			(entry) =>
				entry.reason === "@Module metadata is not a static object literal" ||
				entry.reason.includes("providers"),
		);
		if (providersUnresolved) return;
		ctx.report({
			node: bootstrapCall,
			message:
				"NestFactory.create is called here but no global ValidationPipe is registered (no useGlobalPipes(new ValidationPipe(…)) in this file and no APP_PIPE provider in the scanned modules). Request bodies reach handlers unvalidated. Enable ValidationPipe globally in the bootstrap or provide it under the APP_PIPE token.",
		});
	},
});
