declare const prisma: {
	user: { findMany(args?: unknown): Promise<{ id: number }[]> };
	post: { findMany(args: unknown): Promise<unknown[]> };
};

export async function loadPosts(): Promise<unknown[]> {
	const users = await prisma.user.findMany();
	const result: unknown[] = [];
	for (const group of users) {
		result.push(
			await Promise.all(
				users.map((user) =>
					prisma.post.findMany({ where: { userId: user.id } }),
				),
			),
		);
		void group;
	}
	return result;
}
