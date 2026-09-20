declare const prisma: {
	$executeRawUnsafe(query: string): Promise<number>;
};

export function remove(id: string): Promise<number> {
	return prisma.$executeRawUnsafe("DELETE FROM \"User\" WHERE id = " + id);
}
