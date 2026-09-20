declare const prisma: {
	user: { findMany(args?: unknown): Promise<{ id: number }[]> };
	post: { findMany(args?: unknown): Promise<unknown[]> };
};

export async function loadPosts(): Promise<void> {
	const users = await prisma.user.findMany();
	for (const user of users) {
		const posts = await prisma.post.findMany({
			where: { userId: user.id },
		});
		console.log(posts);
	}
}
