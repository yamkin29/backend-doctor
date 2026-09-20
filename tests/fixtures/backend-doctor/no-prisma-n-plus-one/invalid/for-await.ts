declare const prisma: {
	user: { findUnique(args: unknown): Promise<{ email: string } | null> };
};

export async function printEmails(ids: number[]): Promise<void> {
	for (let index = 0; index < ids.length; index++) {
		const user = await prisma.user.findUnique({ where: { id: ids[index] } });
		console.log(user?.email);
	}
}
