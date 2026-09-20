import type { CallExpression } from "../../engine/parser/types.js";
import { Node, SyntaxKind } from "../../engine/parser/types.js";
import { defineRule } from "../../engine/registry.js";
import { nearestFunctionLike } from "../async/async-calls.js";
import { findModuleApiCalls } from "../shared/module-api-calls.js";

const CHILD_PROCESS = ["child_process", "node:child_process"] as const;

/** Process-spawning surface of child_process (sync and async forms alike). */
const CHILD_PROCESS_CALLS = [
	"exec",
	"execSync",
	"execFile",
	"execFileSync",
	"spawn",
	"spawnSync",
	"fork",
] as const;

/** Connection-establishing member calls (Redis, MongoDB, Prisma `$connect`). */
const CONNECTION_CALLS = ["connect", "$connect"] as const;

/**
 * Class name when `call` sits directly in the constructor body of a model
 * provider of the scanned file. Kind checks only — the prototype-chain trap
 * family (RESEARCH) rules out a `Node.isConstructorDeclaration`-style guard.
 * Work in nested callbacks is out of scope: the nearest function-like
 * ancestor decides.
 */
function providerConstructorOwner(
	call: CallExpression,
	providerNames: ReadonlySet<string>,
): string | undefined {
	const ctor = nearestFunctionLike(call);
	if (!ctor || ctor.getKind() !== SyntaxKind.Constructor) return undefined;
	const parent = ctor.getParent();
	if (!parent || !Node.isClassDeclaration(parent)) return undefined;
	const className = parent.getName();
	if (!className || !providerNames.has(className)) return undefined;
	return className;
}

/**
 * Flags heavy initialization in provider constructors (spec 011 AC-4):
 * process spawning (child_process) and connection establishment
 * (`connect`/`$connect`). Deliberately disjoint from the F005/F006
 * vocabularies — sync fs/crypto and same-file async calls are already owned
 * there, so no call double-fires (design §7, resolution 3). The fix is the
 * Nest lifecycle: `onModuleInit` runs after DI completes and can be awaited.
 */
export const noHeavyConstructorWork = defineRule({
	id: "backend-doctor/no-heavy-constructor-work",
	title: "No heavy constructor work",
	category: "Correctness",
	severity: "warn",
	docs: "docs/rules/backend-doctor/no-heavy-constructor-work.md",
	frameworks: ["nest"],
	create(ctx) {
		const model = ctx.nest;
		if (!model) return;
		const providerNames = new Set(
			model.providers
				.filter((provider) => provider.filePath === ctx.file.filePath)
				.map((provider) => provider.className),
		);
		if (providerNames.size === 0) return;

		const candidates = [
			...findModuleApiCalls(ctx.file, {
				specifiers: CHILD_PROCESS,
				names: CHILD_PROCESS_CALLS,
			}),
			...findModuleApiCalls(ctx.file, { names: CONNECTION_CALLS }),
		];
		for (const { call, name } of candidates) {
			const className = providerConstructorOwner(call, providerNames);
			if (!className) continue;
			ctx.report({
				node: call,
				message: `${name} runs in the constructor of ${className}; heavy initialization runs before DI completes and hides failures from the lifecycle. Move it into onModuleInit so it starts after dependencies are resolved and can be awaited.`,
			});
		}
	},
});
