declare const prisma: {
	user: { findMany(args: unknown): Promise<unknown[]> };
};

export function page(take: number, skip: number): Promise<unknown[]> {
	return prisma.user.findMany({ take, skip });
}
