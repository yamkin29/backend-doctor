declare const prisma: {
	$queryRaw(query: string): Promise<unknown[]>;
};

export function users(name: string): Promise<unknown[]> {
	return prisma.$queryRaw(
		"SELECT * FROM \"User\" WHERE name = '" + name + "'",
	);
}
