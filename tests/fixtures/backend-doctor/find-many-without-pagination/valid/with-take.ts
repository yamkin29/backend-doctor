declare const prisma: {
	user: { findMany(args: unknown): Promise<unknown[]> };
};

export function page(pageIndex: number): Promise<unknown[]> {
	return prisma.user.findMany({
		take: 50,
		skip: pageIndex * 50,
	});
}
