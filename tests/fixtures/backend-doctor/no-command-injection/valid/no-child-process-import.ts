const db = {
	exec: (query: string): string => query,
};

export function migrate(sql: string): void {
	db.exec(sql);
}
