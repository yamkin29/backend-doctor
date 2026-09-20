declare const prisma: {
	user: { create(args: unknown): Promise<unknown> };
	$transaction(fn: unknown): Promise<unknown>;
};

export async function delayedCreate(): Promise<unknown> {
	return prisma.$transaction(async () => {
		await new Promise((resolve) => setTimeout(resolve, 500));
		return prisma.user.create({ data: {} });
	});
}
