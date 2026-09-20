declare const prisma: {
	user: { create(args: unknown): Promise<unknown> };
	$transaction(ops: unknown[]): Promise<unknown[]>;
};

export function batch(): Promise<unknown[]> {
	return prisma.$transaction([
		prisma.user.create({ data: {} }),
		prisma.user.create({ data: { ref: 1 } }),
	]);
}
