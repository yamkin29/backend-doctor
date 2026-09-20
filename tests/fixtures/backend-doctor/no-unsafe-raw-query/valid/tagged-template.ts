declare const prisma: {
	$queryRaw(
		strings: TemplateStringsArray,
		...values: unknown[]
	): Promise<unknown[]>;
};

export function users(name: string): Promise<unknown[]> {
	return prisma.$queryRaw`SELECT * FROM "User" WHERE name = ${name}`;
}
