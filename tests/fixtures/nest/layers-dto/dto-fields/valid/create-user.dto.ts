import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Allow, IsOptional, IsString, ValidateNested } from "class-validator";

export class CreateUserDto {
	@IsString()
	email: string;

	@IsOptional()
	@IsString()
	nickname?: string;

	@ApiProperty()
	@ValidateNested()
	profile: ProfileDto;

	@ApiPropertyOptional()
	@IsOptional()
	@IsString()
	bio?: string;

	@Allow()
	whatever: string;
}
