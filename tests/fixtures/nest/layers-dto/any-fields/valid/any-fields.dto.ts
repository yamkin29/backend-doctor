export class CreateItemDto {
	metadata: Record<string, string>;

	tags: string[] = [];

	count = 0;
}
