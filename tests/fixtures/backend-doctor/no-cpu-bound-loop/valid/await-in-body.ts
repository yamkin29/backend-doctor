export async function drain(): Promise<void> {
	for (let i = 0; i < 1_000_000; i++) {
		await Promise.resolve();
	}
}
