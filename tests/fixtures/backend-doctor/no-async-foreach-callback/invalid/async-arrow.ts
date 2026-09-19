function save(item: string): Promise<void> {
	return Promise.resolve();
}
const items = ["a", "b"];
items.forEach(async (item) => {
	await save(item);
});
