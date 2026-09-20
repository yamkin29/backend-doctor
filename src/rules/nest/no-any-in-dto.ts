import { defineRule } from "../../engine/registry.js";

/** `typeText` forms that read as `any` (whitespace-collapsed, spec 010 AC-9). */
const ANY_TYPES = new Set(["any", "any[]", "Array<any>"]);

/**
 * Flags DTO properties typed `any` — explicitly (`any`, `any[]`,
 * `Array<any>`) or implicitly (no type annotation and no initializer). An
 * untyped property with an initializer stays silent: its intent is
 * ambiguous, and precision comes first (constitution §2).
 */
export const noAnyInDto = defineRule({
	id: "backend-doctor/no-any-in-dto",
	title: "Any in DTO",
	category: "Maintainability",
	severity: "warn",
	docs: "docs/rules/backend-doctor/no-any-in-dto.md",
	frameworks: ["nest"],
	create(ctx) {
		const model = ctx.nest;
		if (!model) return;
		for (const dto of model.dtos) {
			if (dto.filePath !== ctx.file.filePath) continue;
			for (const property of dto.properties) {
				if (property.typeText !== null && ANY_TYPES.has(property.typeText)) {
					ctx.report({
						line: property.line,
						column: property.column,
						message: `${property.name} in ${dto.className} is typed any; the payload shape is unchecked end to end. Give the field a concrete type or a nested DTO class.`,
					});
					continue;
				}
				if (property.typeText === null && !property.hasInitializer) {
					ctx.report({
						line: property.line,
						column: property.column,
						message: `${property.name} in ${dto.className} has no type annotation and no initializer, so it is implicitly any; the payload shape is unchecked end to end. Give the field a concrete type or a nested DTO class.`,
					});
				}
			}
		}
	},
});
