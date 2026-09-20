declare const prisma: {
	user: { create(args: unknown): Promise<unknown> };
	$transaction(fn: unknown): Promise<unknown>;
};

export async function createUser(): Promise<unknown> {
	return prisma.$transaction(async () => {
		const user = await prisma.user.create({ data: {} });
		void user;
		return prisma.user.create({ data: { ref: 1 } });
	});
}
