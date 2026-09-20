declare const axios: { get(url: string): Promise<unknown> };
declare const prisma: {
	user: { create(args: unknown): Promise<unknown> };
	$transaction(fn: unknown): Promise<unknown>;
};

export async function syncProfile(url: string): Promise<unknown> {
	return prisma.$transaction(async () => {
		const profile = await axios.get(url);
		return prisma.user.create({ data: { profile } });
	});
}
