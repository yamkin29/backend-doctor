declare const prisma: {
	$queryRawUnsafe(query: string): Promise<unknown[]>;
};

export function all(): Promise<unknown[]> {
	return prisma.$queryRawUnsafe("SELECT * FROM \"User\"");
}
