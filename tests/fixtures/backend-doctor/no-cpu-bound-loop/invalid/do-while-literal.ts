export function spin(): number {
	let i = 0;
	let total = 0;
	do {
		total += i;
		i++;
	} while (i < 500_000);
	return total;
}
