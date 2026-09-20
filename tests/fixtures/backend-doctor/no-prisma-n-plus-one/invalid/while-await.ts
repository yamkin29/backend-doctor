declare const prisma: {
	order: { count(args: unknown): Promise<number> };
};

export async function countAll(pages: string[]): Promise<void> {
	let total = 0;
	let index = 0;
	while (index < pages.length) {
		total += await prisma.order.count({ where: { page: pages[index] } });
		index++;
	}
	console.log(total);
}
