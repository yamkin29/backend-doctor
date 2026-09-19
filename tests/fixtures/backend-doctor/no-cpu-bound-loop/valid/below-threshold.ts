export function sum(pages: number): number {
	let total = 0;
	for (let i = 0; i < 9_999; i++) {
		total += i;
	}
	return total + pages;
}
