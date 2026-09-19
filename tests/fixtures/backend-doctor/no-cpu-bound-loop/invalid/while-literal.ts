export function spin(limit: number): number {
	let i = 0;
	let total = 0;
	while (i < 250_000) {
		total += i;
		i++;
	}
	return total + limit;
}
