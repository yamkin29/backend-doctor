async function main(items: string[]): Promise<void> {
	for (const item of items) {
		await save(item);
	}
}
function save(item: string): Promise<void> {
	return Promise.resolve();
}
