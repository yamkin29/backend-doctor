declare const prisma: {
	user: { findMany(args?: unknown): Promise<{ id: number }[]> };
	audit: { findMany(args: unknown): Promise<unknown[]> };
};

export async function loadAudits(): Promise<void> {
	const users = await prisma.user.findMany();
	for (const user of users) {
		void prisma.audit.findMany({ where: { userId: user.id } });
	}
}
