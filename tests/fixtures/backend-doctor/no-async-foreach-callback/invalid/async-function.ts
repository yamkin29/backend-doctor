const items = ["a"];
items.forEach(async function (item) {
	await save(item);
});
function save(item: string): Promise<void> {
	return Promise.resolve();
}
