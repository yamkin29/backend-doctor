import { IsInt, IsOptional, Max, Min } from "class-validator";

export class ListUsersDto {
	@IsOptional()
	@IsInt()
	@Min(1)
	@Max(100)
	take?: number;

	@IsOptional()
	@IsInt()
	@Min(0)
	skip?: number;
}
