declare const prisma: {
	user: { findMany(args?: unknown): Promise<unknown[]> };
	setting: { findMany(args?: unknown): Promise<unknown[]> };
};

export async function loadSettings(): Promise<unknown[]> {
	const users = await prisma.user.findMany();
	for (const user of users) {
		console.log(user);
	}
	return prisma.setting.findMany();
}
