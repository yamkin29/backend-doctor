class Users {
	async load(): Promise<void> {}
	refresh(): void {
		this.load();
	}
}
