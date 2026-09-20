import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

export class CreateUserDto {
	email: string;

	@ApiProperty()
	role: string;

	@ApiPropertyOptional()
	bio?: string;
}
