declare const prisma: {
	user: { findMany(args: unknown): Promise<unknown[]> };
};

export function actives(active: boolean): Promise<unknown[]> {
	return prisma.user.findMany({
		where: { active },
		orderBy: { id: "asc" },
	});
}
