declare function fetch(url: string): Promise<unknown>;
declare const prisma: {
	user: { create(args: unknown): Promise<unknown> };
	$transaction(fn: unknown): Promise<unknown>;
};

export async function syncUser(url: string): Promise<unknown> {
	return prisma.$transaction(async () => {
		const profile = await fetch(url);
		return prisma.user.create({ data: { profile } });
	});
}
