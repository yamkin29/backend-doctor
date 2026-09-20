declare const prisma: {
	post: { findMany(args: unknown): Promise<unknown[]> };
};

export async function loadPosts(userIds: number[]): Promise<unknown[]> {
	return prisma.post.findMany({
		where: { userId: { in: userIds } },
	});
}
