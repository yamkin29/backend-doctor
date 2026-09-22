import {
	IsInt,
	IsNotEmpty,
	Max,
	Min,
	MinLength,
} from "class-validator";

export class CreateUserDto {
	@IsString()
	@MinLength(1)
	name!: string;

	@IsInt()
	@Min(0)
	@Max(150)
	age!: number;
}
