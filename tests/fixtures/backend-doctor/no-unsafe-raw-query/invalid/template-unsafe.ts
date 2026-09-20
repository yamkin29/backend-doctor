declare const prisma: {
	$queryRawUnsafe(query: string): Promise<unknown[]>;
};

export function users(name: string): Promise<unknown[]> {
	return prisma.$queryRawUnsafe(
		`SELECT * FROM "User" WHERE name = '${name}'`,
	);
}
