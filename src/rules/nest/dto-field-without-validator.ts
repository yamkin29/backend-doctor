import { defineRule } from "../../engine/registry.js";

/**
 * Property decorators that describe/transform instead of validating
 * (spec 010 AC-8). Everything outside this set — all class-validator
 * `Is*`/`Min`/`Max`/`Length`/… names, `Validate*`, `Allow`, `Array*` and any
 * unknown custom validator — counts as a validator, so an unrecognized
 * decorator never produces a finding (precision over recall).
 */
const NON_VALIDATORS = new Set([
	"ApiProperty",
	"ApiPropertyOptional",
	"ApiHideProperty",
	"Field",
	"HideField",
	"Expose",
	"Exclude",
	"Type",
	"Transform",
	"Column",
	"PrimaryColumn",
	"PrimaryGeneratedColumn",
	"CreateDateColumn",
	"UpdateDateColumn",
	"DeleteDateColumn",
	"VersionColumn",
	"ObjectIdColumn",
	"Index",
	"Generated",
]);

/**
 * Flags DTO properties decorated with nothing outside the non-validator
 * blacklist — including properties with no decorators at all. With a global
 * ValidationPipe those fields are never validated (spec 010 AC-8).
 */
export const dtoFieldWithoutValidator = defineRule({
	id: "backend-doctor/dto-field-without-validator",
	title: "DTO field without validator",
	category: "Correctness",
	severity: "warn",
	docs: "docs/rules/backend-doctor/dto-field-without-validator.md",
	frameworks: ["nest"],
	create(ctx) {
		const model = ctx.nest;
		if (!model) return;
		for (const dto of model.dtos) {
			if (dto.filePath !== ctx.file.filePath) continue;
			for (const property of dto.properties) {
				const validated = property.decoratorNames.some(
					(name) => !NON_VALIDATORS.has(name),
				);
				if (validated) continue;
				ctx.report({
					line: property.line,
					column: property.column,
					message: `${property.name} in ${dto.className} has no validation decorator; with a global ValidationPipe it is never validated. Add a class-validator decorator (@IsString, @IsInt, @IsOptional, …).`,
				});
			}
		}
	},
});
