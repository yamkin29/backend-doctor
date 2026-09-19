async function main(): Promise<void> {
	const items = ["a", "b"];
	await Promise.all(items.map(async (item) => save(item)));
}
function save(item: string): Promise<void> {
	return Promise.resolve();
}
