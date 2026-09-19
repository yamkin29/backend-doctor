export function spin(): number {
	let total = 0;
	for (let i = 0; i < 2 ** 31; i++) {
		total += i;
	}
	return total;
}
