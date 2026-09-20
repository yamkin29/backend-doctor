declare const external: { fetchAll(key: string): Promise<unknown[]> };

export class Repository {
	findMany(key: string): Promise<unknown[]> {
		return external.fetchAll(key);
	}

	async loadAll(keys: string[]): Promise<void> {
		for (const key of keys) {
			await this.findMany(key);
		}
	}
}
