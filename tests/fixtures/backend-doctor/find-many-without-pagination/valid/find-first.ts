declare const prisma: {
	user: {
		findFirst(args?: unknown): Promise<unknown>;
		findMany(args: unknown): Promise<unknown[]>;
	};
};

export function one(): Promise<unknown> {
	return prisma.user.findFirst();
}

export function many(): Promise<unknown[]> {
	return prisma.user.findMany({ take: 10 });
}
