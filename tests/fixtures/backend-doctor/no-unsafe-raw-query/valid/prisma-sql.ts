declare const prisma: {
	$queryRawUnsafe(query: unknown): Promise<unknown[]>;
};
declare const Prisma: {
	sql(strings: TemplateStringsArray, ...values: unknown[]): unknown;
};

export function users(ids: number[]): Promise<unknown[]> {
	return prisma.$queryRawUnsafe(
		Prisma.sql`SELECT * FROM "User" WHERE id IN (${ids.join(", ")})`,
	);
}
