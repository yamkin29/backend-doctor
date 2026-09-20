declare const prisma: {
	user: { findMany(): Promise<unknown[]> };
};

export function all(): Promise<unknown[]> {
	return prisma.user.findMany();
}
