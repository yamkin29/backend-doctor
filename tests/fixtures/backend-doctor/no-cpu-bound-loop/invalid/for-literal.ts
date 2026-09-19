export function spin(): number {
	let total = 0;
	for (let i = 0; i < 100_000; i++) {
		total += i;
	}
	return total;
}
