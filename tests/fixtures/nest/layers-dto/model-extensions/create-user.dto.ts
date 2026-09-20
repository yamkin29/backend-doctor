import { ApiProperty, IsString } from "class-validator";

export class CreateUserDto {
	@ApiProperty()
	@IsString()
	email: string;

	tags?: any[];

	backup: Array<any>;

	bare;

	count = 0;

	static KIND = "user";
}
