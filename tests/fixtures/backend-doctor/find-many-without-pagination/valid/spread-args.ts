declare const prisma: {
	user: { findMany(...args: unknown[]): Promise<unknown[]> };
};

export function withOptions(options: unknown): Promise<unknown[]> {
	return prisma.user.findMany(...options);
}

export function withVariable(options: unknown): Promise<unknown[]> {
	return prisma.user.findMany(options);
}
